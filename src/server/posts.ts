// Post service — create / edit / schedule / publish. Pure domain rules live in
// @/domain/post; this layer owns Prisma I/O and adapter calls.
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/adapters/channels/types";
import {
  derivePostStatus,
  markVariantFailed,
  markVariantPublished,
  validateSchedule,
  validateVariantContent,
} from "@/domain/post";
import { ApiError } from "./errors";
import { decryptString } from "@/lib/crypto";

export interface VariantInput {
  channelSlug: string;
  content: string;
}

export interface PublishSummary {
  published: number;
  failed: number;
  skipped: number;
}

const POST_INCLUDE = {
  variants: { include: { channel: true }, orderBy: { id: "asc" as const } },
} satisfies Prisma.PostInclude;

export async function createPost(
  prisma: PrismaClient,
  input: { workspaceId: string; title?: string | null; variants: VariantInput[] },
) {
  if (input.variants.length === 0) {
    throw new ApiError(400, "post needs at least one variant");
  }

  const slugs = [...new Set(input.variants.map((v) => v.channelSlug))];
  const channels = await prisma.channel.findMany({ where: { slug: { in: slugs } } });
  const channelBySlug = new Map(channels.map((c) => [c.slug, c]));

  const variantData = input.variants.map((v) => {
    const validation = validateVariantContent(v.channelSlug, v.content);
    if (!validation.ok) {
      throw new ApiError(400, `${v.channelSlug}: ${validation.reason}`);
    }
    const channel = channelBySlug.get(v.channelSlug);
    if (!channel) {
      throw new ApiError(400, `unknown channel "${v.channelSlug}"`);
    }
    const content = v.content.trim();
    return {
      channelId: channel.id,
      content,
      charCount: content.length,
    };
  });

  return prisma.post.create({
    data: {
      workspaceId: input.workspaceId,
      title: input.title?.trim() || null,
      status: "DRAFT",
      variants: { create: variantData },
    },
    include: POST_INCLUDE,
  });
}

export async function updateVariant(
  prisma: PrismaClient,
  workspaceId: string,
  variantId: string,
  content: string,
) {
  const variant = await prisma.postVariant.findUnique({
    where: { id: variantId },
    include: { post: { select: { workspaceId: true, status: true } }, channel: true },
  });
  if (!variant || variant.post.workspaceId !== workspaceId) {
    throw new ApiError(404, "variant not found");
  }
  if (variant.post.status === "PUBLISHED") {
    throw new ApiError(400, "cannot edit a published post");
  }
  const validation = validateVariantContent(variant.channel.slug, content);
  if (!validation.ok) {
    throw new ApiError(400, validation.reason);
  }
  const trimmed = content.trim();
  return prisma.postVariant.update({
    where: { id: variantId },
    data: { content: trimmed, charCount: trimmed.length, publishState: "DRAFT", errorMessage: null, publishedAt: null },
  });
}

export async function schedulePost(
  prisma: PrismaClient,
  workspaceId: string,
  postId: string,
  scheduledAt: Date,
) {
  const validation = validateSchedule(scheduledAt);
  if (!validation.ok) {
    throw new ApiError(400, validation.reason);
  }
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new ApiError(404, "post not found");
  if (post.status === "PUBLISHED") {
    throw new ApiError(400, "cannot schedule a published post");
  }
  return prisma.post.update({
    where: { id: postId },
    data: { scheduledAt, status: "SCHEDULED" },
    include: POST_INCLUDE,
  });
}

export async function cancelSchedule(
  prisma: PrismaClient,
  workspaceId: string,
  postId: string,
) {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new ApiError(404, "post not found");
  if (post.status === "PUBLISHED") {
    throw new ApiError(400, "cannot cancel schedule of a published post");
  }
  return prisma.post.update({
    where: { id: postId },
    data: { scheduledAt: null, status: derivePostStatus({ scheduledAt: null, publishedAt: null }) },
    include: POST_INCLUDE,
  });
}

/**
 * Publish all ready variants of a post through their channel adapters.
 * One channel failing never blocks the others (spec §5).
 */
export async function publishPost(
  prisma: PrismaClient,
  adapters: Record<string, ChannelAdapter>,
  encryptionKey: Buffer,
  workspaceId: string,
  postId: string,
): Promise<{ post: Awaited<ReturnType<typeof prisma.post.findFirst>>; summary: PublishSummary }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId },
    include: POST_INCLUDE,
  });
  if (!post) throw new ApiError(404, "post not found");
  if (post.variants.every((v) => v.publishState === "PUBLISHED")) {
    throw new ApiError(400, "post is already published");
  }

  const summary: PublishSummary = { published: 0, failed: 0, skipped: 0 };
  const now = new Date();

  for (const variant of post.variants) {
    if (variant.publishState === "PUBLISHED") {
      summary.skipped += 1;
      continue;
    }

    const validation = validateVariantContent(variant.channel.slug, variant.content);
    if (!validation.ok) {
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantFailed(validation.reason),
      });
      summary.failed += 1;
      continue;
    }

    const connection = await prisma.oAuthConnection.findUnique({
      where: { workspaceId_channelId: { workspaceId, channelId: variant.channelId } },
    });
    if (!connection) {
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantFailed("channel not connected"),
      });
      summary.failed += 1;
      continue;
    }

    const adapter = adapters[variant.channel.slug];
    if (!adapter) {
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantFailed(`no adapter for channel "${variant.channel.slug}"`),
      });
      summary.failed += 1;
      continue;
    }

    try {
      const accessToken = decryptString(connection.accessToken, encryptionKey);
      await adapter.publish(variant.content, { accessToken });
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantPublished(now),
      });
      summary.published += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantFailed(message),
      });
      summary.failed += 1;
    }
  }

  const hadPublishedVariant =
    summary.published > 0 ||
    post.variants.some((v) => v.publishState === "PUBLISHED");
  const updated = await prisma.post.update({
    where: { id: postId },
    data: hadPublishedVariant ? { publishedAt: now, status: "PUBLISHED" } : {},
    include: POST_INCLUDE,
  });

  return { post: updated, summary };
}

export async function listPosts(prisma: PrismaClient, workspaceId: string) {
  return prisma.post.findMany({
    where: { workspaceId },
    include: POST_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
}

/** Posts visible on the calendar: scheduled or published within [start, end).
 * SCHEDULED posts that are overdue (scheduledAt < start, no queue in M1) still
 * show in their original slot instead of silently disappearing. */
export async function getCalendarEvents(
  prisma: PrismaClient,
  workspaceId: string,
  start: Date,
  end: Date,
  channelSlugs?: string[],
) {
  const channels = channelSlugs?.length
    ? await prisma.channel.findMany({ where: { slug: { in: channelSlugs } } })
    : [];
  const channelIds = channels.map((c) => c.id);
  return prisma.post.findMany({
    where: {
      workspaceId,
      ...(channelIds.length > 0
        ? { variants: { some: { channelId: { in: channelIds } } } }
        : {}),
      OR: [
        { status: "SCHEDULED", scheduledAt: { lt: end } },
        { status: "PUBLISHED", publishedAt: { gte: start, lt: end } },
      ],
    },
    include: POST_INCLUDE,
    orderBy: [{ status: "desc" }, { scheduledAt: "asc" }],
  });
}
