# Inbox Phase 1 data model: conversation rows are messages

M6 Inbox Phase 1 models the Inbox as **rows-as-messages**: each `Conversation` row is one message exchange (direction + content + timestamp), and the "conversation" a user sees in the Inbox list is a **query-time aggregation** (GROUP BY contact × channel), not a first-class entity. There is no `Thread` table and no `Message` table.

**Why**: `Conversation` is an Interaction subtype — every message belongs on the Contact timeline alongside ContentTouch and Event rows, and the timeline/compute paths (lifecycle recompute, persona stats, analytics) already operate on Interaction rows. A Thread table would duplicate that model (a thread is a grouping of rows that already carry contactId + channelId + timestamp) and force conversation-level state (open/closed, unread) to be stored in two places. Unread/read state is persisted separately in `InboxReadState` (workspace + contact + channel unique, `lastReadAt`) because "read" is user consumption state that cannot be derived from timestamps alone. Grouping key is contact × channel, not contact alone: the same person messaging from X and LinkedIn shows as two list rows (concept-doc mock: each row carries one channel badge).

**Consequences**:
- `Conversation` gains `content` (message body), nullable `postId` (comment-pipeline replies reference the originating Post), and a unique `externalId` (platform-side message id — dedup/idempotency when real channel inbound lands).
- Inbound pipeline is Mock-first: `MockAdapter` generates a simulated comment 30–90s after a publish (delayed BullMQ job), creating the inbound row through the same path a real channel poll will use. X inbound waits for developer approval (ADR-0012 schedule risk).
- A future real-channel integration (X, Discord rooms) can add community/room structure without migrating the 1:1 model — Room handling remains a documented UI concept, not schema (no Discord/Slack channel exists in Phase 1).
