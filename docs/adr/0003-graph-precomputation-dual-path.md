# Customer Graph pre-computation with dual-path refresh

The Customer Graph uses a two-layer read model: an event-triggered incremental refresh (< 3 second latency) for immediate context needs, and an hourly batch pass that recomputes full Persona derivations only for Contacts flagged as dirty.

**Why**: The AI engine never reads raw Interaction records directly — that would consume thousands of tokens per query and miss the token budget for any useful inference. Instead, a pre-computation layer distills millions of raw interactions into compact structured summaries (Top-K recent interactions, compressed Sentiment Arc, Content DNA aggregates, Lifecycle Stage). The dual-path design solves a scheduling tension: Inbox needs real-time context (a Contact's latest message must be visible within seconds), while Persona derivations like Content DNA require cross-Contact comparison that only makes sense in batch.

**Considered alternatives**: Pure batch (hourly) was rejected because Inbox conversations would open with stale data. Pure event-driven was rejected because Content DNA computation needs global statistics — processing every individual click in isolation produces no signal.
