# MCP Inbox tools are a PII exception domain

The M5 security baseline states MCP contact tools never return PII (`profile_*` fields, single source of truth `src/server/contact-select.ts`). The M6 Inbox module is an explicit exception: `inbox.list` / `inbox.read` / `inbox.reply` return full conversation content — which is by definition PII (private dialogue).

**Why**: The primary persona is AI-native builders whose core M6 use case is letting an agent handle conversations. Returning only metadata (who, when, direction) makes the module useless for that case; content redaction is fragile (regex-based cleaning misses, and false cleaning corrupts the message semantics the agent needs). The risk is instead controlled by gates: a workspace-level `mcpInboxAccess` toggle (default **false** — the whole module rejects when off) plus the existing `MCP_WRITE_DAILY_CAP` on `inbox.reply`. The contact-module contract ("never return PII") is unchanged — the exception is scoped to the inbox module and documented per-module in docs/api.md.

**Consequences**:
- `Workspace.mcpInboxAccess` is a new field; it deliberately does NOT reuse `mcpPublishApproval` (default true = reject) because the default posture differs (default false = reject) and the two gates guard different tool families.
- The PII contract in docs/api.md must state the boundary per module: contact tools = no PII; inbox tools = full content, gated.
- When real-channel inbound lands, the same gate applies — the exception is about the module, not the channel.
