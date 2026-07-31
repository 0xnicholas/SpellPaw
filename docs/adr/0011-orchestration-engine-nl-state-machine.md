# Orchestration engine: natural language goal + state machine execution

The Orchestration Engine (Phase 3) operates in two layers: a user-provided natural language goal is converted by the AI model into a JSON Plan, which is then executed deterministically by a state machine — not by an AI agent running open-ended tool calls.

**Why**: An AI agent executing Campaign steps (publish posts, monitor inbox, trigger follow-ups) in an open-ended loop risks hallucinating actions, skipping required approval gates, or entering infinite retry cycles. By separating plan generation (AI, creative) from plan execution (state machine, deterministic), the engine gets the flexibility of natural language input without the risk of autonomous execution. The state machine enforces approval gates, retry policies, failure classifications (retryable, skippable, requires-pause), and the hard boundary that destructive operations (delete, bulk-send, modify-live-campaign) are never executable without human confirmation.

**Considered alternative**: Full AI-driven execution where the model calls tools directly until the goal is met. Rejected because at current LLM reliability levels, this introduces unacceptable risk of mis-execution in a product where users are paying for business outcomes. A model that accidentally publishes 50 posts instead of 5, or sends a follow-up to a Contact who already churned, undermines the trust the entire product depends on.

**Consequence**: The Plan schema (the JSON format the AI generates) is the contract between the AI layer and the execution layer. It must be versioned, validated, and backward-compatible. Any change to what the Orchestration Engine can do requires updating both the prompt that generates Plans and the state machine that executes them.
