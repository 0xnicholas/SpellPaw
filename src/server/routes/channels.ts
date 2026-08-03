// /api/channels routes — connect (OAuth start/callback) + status + disconnect.
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { ApiError } from "../errors";
import {
  completeConnect,
  disconnectChannel,
  listChannelsWithStatus,
  startConnect,
  workspaceIdFromState,
} from "../channels";
import type { AppEnv, RouteDeps } from "./shared";

const oauthStateCookie = (slug: string) => `sp_oauth_state_${slug}`;
const oauthVerifierCookie = (slug: string) => `sp_oauth_verifier_${slug}`;

export function channelsRoutes(deps: RouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const channels = await listChannelsWithStatus(deps.prisma, c.get("workspaceId"));
    return c.json({ channels });
  });

  app.post("/:slug/connect", async (c) => {
    const slug = c.req.param("slug");
    const adapter = deps.adapters[slug];
    if (!adapter) throw new ApiError(404, `unknown channel "${slug}"`);
    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/channels/${slug}/callback`;
    const pending = startConnect(adapter, redirectUri, c.get("workspaceId"));
    const secure = process.env.NODE_ENV === "production";
    setCookie(c, oauthStateCookie(slug), pending.state, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: `/api/channels/${slug}`,
      maxAge: 600,
    });
    setCookie(c, oauthVerifierCookie(slug), pending.verifier, {
      httpOnly: true,
      sameSite: "Lax",
      secure,
      path: `/api/channels/${slug}`,
      maxAge: 600,
    });
    return c.json({ url: pending.authUrl });
  });

  app.get("/:slug/callback", async (c) => {
    const slug = c.req.param("slug");
    const adapter = deps.adapters[slug];
    if (!adapter) throw new ApiError(404, `unknown channel "${slug}"`);

    const code = c.req.query("code");
    const state = c.req.query("state");
    const expectedState = getCookie(c, oauthStateCookie(slug));
    const verifier = getCookie(c, oauthVerifierCookie(slug));
    const accountId = c.get("accountId");

    // The state embeds the initiating workspace; resolve it for THIS account so
    // the connection lands in the right workspace even for non-default ones.
    const stateWorkspaceId = state ? workspaceIdFromState(state) : null;
    const workspace = stateWorkspaceId
      ? await deps.prisma.workspace.findFirst({ where: { id: stateWorkspaceId, accountId } })
      : null;

    const origin = new URL(c.req.url).origin;
    const redirectUri = `${origin}/api/channels/${slug}/callback`;
    const failUrl = `/${workspace?.id ?? ""}/channels?error=connect_failed`;

    if (!code || !state || !expectedState || !verifier || !workspace) {
      return c.redirect(`${failUrl}&reason=missing_params`);
    }
    try {
      await completeConnect(deps.prisma, adapter, {
        workspaceId: workspace.id,
        channelSlug: slug,
        code,
        state,
        expectedState,
        verifier,
        redirectUri,
        encryptionKey: deps.encryptionKey,
      });
      return c.redirect(`/${workspace.id}/channels?connected=${slug}`);
    } catch {
      return c.redirect(`${failUrl}&reason=exchange_failed`);
    }
  });

  app.delete("/:slug", async (c) => {
    const result = await disconnectChannel(deps.prisma, c.get("workspaceId"), c.req.param("slug"));
    return c.json(result);
  });

  return app;
}
