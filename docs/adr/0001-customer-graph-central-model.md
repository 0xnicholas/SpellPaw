# Customer Graph as central data model

All SpellPaw data — content posts, inbox conversations, and customer lifecycle — is stored in a single contact-centric data model called the Customer Graph, not siloed per Surface.

**Why**: Existing tools (EveryFeed for content, Intercom for support, Zapier for glue) keep these in separate databases, making cross-time and cross-channel reasoning impossible. A Contact who viewed a LinkedIn post last week and now messages through X is two records in two systems — no single system knows both facts. The Customer Graph models every external touchpoint (Content Touch, Conversation, Event) as an Interaction on a unified Contact timeline, enabling the AI engine to reason across Surfaces with full context.

**Considered alternative**: Separate databases per Surface with an event bus between them. Rejected because querying across Surfaces would require materialized joins external to either database — the core value proposition depends on the AI engine reading a single contact record, not fanning out to N databases and reconciling.
