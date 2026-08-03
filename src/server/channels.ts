// Channel connection service — OAuth2 "connect" flow (ADR-0004, integrated-party keys).
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { ChannelAdapter } from "@/adapters/channels/types";
import { computeCodeChallenge, generatePkceVerifier } from "@/adapters/channels/pkce";
import { encryptString } from "@/lib/crypto";
import { ApiError } from "./errors";
import { enforceChannelLimit } from "./limits";

export async function listChannelsWithStatus(prisma: PrismaClient, workspaceId: string) {
  const channels = await prisma.channel.findMany({
    orderBy: { slug: "asc" },
    include: { connections: { where: { workspaceId }, select: { id: true, connectedAt: true } } },
  });
  return channels.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    connected: c.connections.length > 0,
    connectedAt: c.connections[0]?.connectedAt ?? null,
  }));
}

export interface PendingConnect {
  authUrl: string;
  state: string;
  verifier: string;
}

/**
 * Starts the OAuth dance; the caller stores { state, verifier } (cookies).
 * The state embeds the workspace id so the callback can reconnect the OAuth
 * redirect to the workspace that initiated it (a plain GET callback can't
 * carry the x-workspace-id header).
 */
export function startConnect(
  adapter: ChannelAdapter,
  redirectUri: string,
  workspaceId: string,
): PendingConnect {
  const state = `${workspaceId}.${randomBytes(16).toString("hex")}`;
  const verifier = generatePkceVerifier();
  const challenge = computeCodeChallenge(verifier);
  return { authUrl: adapter.buildAuthUrl(state, redirectUri, challenge), state, verifier };
}

export function workspaceIdFromState(state: string): string | null {
  return state.split(".")[0] ?? null;
}

function tokenRow(tokens: Awaited<ReturnType<ChannelAdapter["exchangeCode"]>>, key: Buffer) {
  return {
    accessToken: encryptString(tokens.accessToken, key),
    refreshToken: tokens.refreshToken ? encryptString(tokens.refreshToken, key) : null,
    expiresAt: tokens.expiresAt ?? null,
  };
}

export async function completeConnect(
  prisma: PrismaClient,
  adapter: ChannelAdapter,
  input: {
    workspaceId: string;
    channelSlug: string;
    code: string;
    state: string;
    expectedState: string;
    verifier: string;
    redirectUri: string;
    encryptionKey: Buffer;
  },
) {
  if (input.state !== input.expectedState) {
    throw new ApiError(400, "OAuth state mismatch");
  }
  const channel = await prisma.channel.findUnique({ where: { slug: input.channelSlug } });
  if (!channel) throw new ApiError(404, `unknown channel "${input.channelSlug}"`);
  await enforceChannelLimit(prisma, input.workspaceId);

  let tokens;
  try {
    tokens = await adapter.exchangeCode(input.code, input.redirectUri, input.verifier);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(502, `connect failed: ${message}`);
  }

  return prisma.oAuthConnection.upsert({
    where: { workspaceId_channelId: { workspaceId: input.workspaceId, channelId: channel.id } },
    update: {
      ...tokenRow(tokens, input.encryptionKey),
      connectedAt: new Date(),
    },
    create: {
      workspaceId: input.workspaceId,
      channelId: channel.id,
      ...tokenRow(tokens, input.encryptionKey),
    },
  });
}

export async function disconnectChannel(
  prisma: PrismaClient,
  workspaceId: string,
  channelSlug: string,
) {
  const channel = await prisma.channel.findUnique({ where: { slug: channelSlug } });
  if (!channel) throw new ApiError(404, `unknown channel "${channelSlug}"`);
  const result = await prisma.oAuthConnection.deleteMany({
    where: { workspaceId, channelId: channel.id },
  });
  if (result.count === 0) throw new ApiError(404, "channel is not connected");
  return { disconnected: true };
}
