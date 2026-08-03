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
import { decryptString, encryptString } from "@/lib/crypto";
import { enforcePostLimit } from "./limits";
import type { Publisher } from "./publisher";
import type { TokenSet } from "@/adapters/channels/types";

export interface VariantInput {
  channelSlug: string;
  content: string;
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
  await enforcePostLimit(prisma, input.workspaceId);

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
  publisher: Publisher,
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
  const updated = await prisma.post.update({
    where: { id: postId },
    data: { scheduledAt, status: "SCHEDULED" },
    include: POST_INCLUDE,
  });
  await publisher.schedule(postId, workspaceId, scheduledAt);
  return updated;
}

export async function cancelSchedule(
  prisma: PrismaClient,
  publisher: Publisher,
  workspaceId: string,
  postId: string,
) {
  const post = await prisma.post.findFirst({ where: { id: postId, workspaceId } });
  if (!post) throw new ApiError(404, "post not found");
  if (post.status === "PUBLISHED") {
    throw new ApiError(400, "cannot cancel schedule of a published post");
  }
  const updated = await prisma.post.update({
    where: { id: postId },
    data: { scheduledAt: null, status: derivePostStatus({ scheduledAt: null, publishedAt: null }) },
    include: POST_INCLUDE,
  });
  await publisher.cancelSchedule(postId, workspaceId);
  return updated;
}

// --- Queue-era publish path (M2) -------------------------------------------

/** Permanent failures (validation, missing connection) must not be retried. */
export class PermanentPublishError extends Error {}

/**
 * Core publish step — shared by the BullMQ worker and the sync test fake.
 * Marks the variant in the DB itself; callers settle the post afterwards.
 *
 * Failure classification:
 * - permanent (validation / no connection / no adapter): marks FAILED and
 *   throws PermanentPublishError so queue workers skip retries;
 * - transient (platform API error): returns "failed" without touching the DB —
 *   the queue layer decides retry vs. final FAILED.
 */
export async function publishVariantToChannel(
  prisma: PrismaClient,
  adapters: Record<string, ChannelAdapter>,
  encryptionKey: Buffer,
  variant: {
    id: string;
    content: string;
    channel: { slug: string };
    channelId: string;
  },
  workspaceId: string,
): Promise<{ state: "published" } | { state: "failed"; message: string }> {
  const validation = validateVariantContent(variant.channel.slug, variant.content);
  if (!validation.ok) {
    await prisma.postVariant.update({
      where: { id: variant.id },
      data: markVariantFailed(validation.reason),
    });
    throw new PermanentPublishError(validation.reason);
  }

  const connection = await prisma.oAuthConnection.findUnique({
    where: { workspaceId_channelId: { workspaceId, channelId: variant.channelId } },
  });
  if (!connection) {
    const message = "channel not connected";
    await prisma.postVariant.update({
      where: { id: variant.id },
      data: markVariantFailed(message),
    });
    throw new PermanentPublishError(message);
  }

  const adapter = adapters[variant.channel.slug];
  if (!adapter) {
    const message = `no adapter for channel "${variant.channel.slug}"`;
    await prisma.postVariant.update({
      where: { id: variant.id },
      data: markVariantFailed(message),
    });
    throw new PermanentPublishError(message);
  }

  try {
    let tokens: TokenSet = {
      accessToken: decryptString(connection.accessToken, encryptionKey),
      refreshToken: connection.refreshToken
        ? decryptString(connection.refreshToken, encryptionKey)
        : null,
      expiresAt: connection.expiresAt,
    };
    // Platforms with rotating access tokens (X: 2h) get a silent refresh when
    // stale, and the rotated set is written back (encrypted) for next time.
    // A failed refresh means the grant is dead (revoked/expired refresh token)
    // — permanent, like "channel not connected": mark FAILED, skip retries.
    if (adapter.refresh && needsRefresh(tokens)) {
      let rotated: TokenSet;
      try {
        rotated = await adapter.refresh(tokens);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const reason = `token refresh failed: ${message} — reconnect the channel in Settings`;
        await prisma.postVariant.update({
          where: { id: variant.id },
          data: markVariantFailed(reason),
        });
        throw new PermanentPublishError(reason);
      }
      await prisma.oAuthConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: encryptString(rotated.accessToken, encryptionKey),
          refreshToken: rotated.refreshToken
            ? encryptString(rotated.refreshToken, encryptionKey)
            : null,
          expiresAt: rotated.expiresAt ?? null,
        },
      });
      tokens = rotated;
    }
    await adapter.publish(variant.content, tokens);
    await prisma.postVariant.update({
      where: { id: variant.id },
      data: markVariantPublished(new Date()),
    });
    return { state: "published" };
  } catch (err) {
    // Permanent failures must escape to the queue worker so it skips retries.
    if (err instanceof PermanentPublishError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return { state: "failed", message };
  }
}

/** Refresh only when we know the token expires and it is stale (5 min margin). */
function needsRefresh(tokens: TokenSet): boolean {
  if (!tokens.expiresAt) return false;
  return tokens.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000;
}

/**
 * Recompute the post-level status after variant state changes: any published
 * variant → PUBLISHED (publishedAt stamped once); none → unchanged.
 */
export async function settlePost(prisma: PrismaClient, postId: string, now: Date = new Date()) {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { variants: { select: { publishState: true } } },
  });
  if (!post) return null;
  const anyPublished = post.variants.some((v) => v.publishState === "PUBLISHED");
  if (!anyPublished) return post;
  return prisma.post.update({
    where: { id: postId },
    data: { status: "PUBLISHED", publishedAt: post.publishedAt ?? now },
    include: POST_INCLUDE,
  });
}

/**
 * Queue-based publish: validate locally, mark invalid variants FAILED, and
 * hand the rest to the publisher (BullMQ in prod, sync fake in tests).
 */
export async function publishPost(
  prisma: PrismaClient,
  publisher: Publisher,
  workspaceId: string,
  postId: string,
): Promise<{ queued: number; postId: string }> {
  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId },
    include: POST_INCLUDE,
  });
  if (!post) throw new ApiError(404, "post not found");
  if (post.variants.every((v) => v.publishState === "PUBLISHED")) {
    throw new ApiError(400, "post is already published");
  }

  const ready: string[] = [];
  for (const variant of post.variants) {
    if (variant.publishState === "PUBLISHED") continue;
    const validation = validateVariantContent(variant.channel.slug, variant.content);
    if (!validation.ok) {
      await prisma.postVariant.update({
        where: { id: variant.id },
        data: markVariantFailed(validation.reason),
      });
      continue;
    }
    ready.push(variant.id);
  }

  const { queued } = await publisher.enqueuePublish(postId, workspaceId, ready);
  return { queued, postId };
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
