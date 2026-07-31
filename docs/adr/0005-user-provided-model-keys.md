# User-provided model API keys

AI inference costs (OpenAI, Anthropic) are borne by the user through their own API keys, not proxied through SpellPaw. The platform only routes prompts and handles orchestration.

**Why**: Variable AI inference costs would make fixed-price SaaS pricing impossible to sustain — a single Growth plan user ($79/mo) generating 1,000 AI-drafted posts and 500 AI replies could consume hundreds of dollars in API fees. Passing costs to users aligns incentives: the user pays for what they consume, and SpellPaw's pricing reflects the orchestration and data platform value, not the underlying model cost. This also avoids the platform becoming a single point of API quota exhaustion for all users.

**Considered alternative**: SpellPaw proxies all AI calls through its own keys and bakes model costs into pricing tiers. Rejected because inference costs vary by orders of magnitude across usage patterns, making per-user pricing either unprofitable at the low end or uncompetitive at the high end.

**Consequence**: Users must configure at least one model API key (OpenAI or Anthropic) before AI features work. If the key expires or hits its quota, AI features degrade gracefully — Content Surface falls back to manual editing, Inbox Agent shows raw messages without AI summaries, and the Orchestration Engine pauses until the key is restored.
