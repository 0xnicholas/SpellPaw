# OAuth integrated party key for platform APIs

SpellPaw manages its own OAuth application credentials (Twitter, LinkedIn, Instagram) and calls platform APIs on behalf of users after they authorize through OAuth, rather than requiring each user to supply their own platform API keys.

**Why**: Requiring users to register developer applications on Twitter, LinkedIn, and Instagram — each with its own application portal, approval process, and API quota management — would make onboarding prohibitively complex. A user who wants to publish to 3 channels would need to configure 3 separate developer accounts before writing their first post. With integrated party keys, onboarding is a single OAuth authorization flow per channel.

**Consequence**: SpellPaw is responsible for staying within platform-level rate limits and fairly allocating quota across users. This is handled by a user-level round-robin queuing system with a shared token bucket limiter.
