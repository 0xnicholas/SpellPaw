# Monolithic deployment for Phase 1 and 2

SpellPaw deploys as a single Node.js service with three code modules (Content Surface, Inbox Surface, Timeline Surface) loaded in-process, not as microservices.

**Why**: Phase 1 has only one Surface (Content), Phase 2 adds a second (Inbox). Under 20,000 monthly active contacts, a monolithic deployment has no performance bottleneck and dramatically lower operations overhead for a product targeting SMBs and solo builders. Each Surface is a well-defined code module sharing the same Customer Graph database — splitting them into separate services before Phase 3 would add network latency, deployment complexity, and transaction boundary problems for no benefit.

**Consequence**: The API layer is structured by route prefix (`/api/content/`, `/api/inbox/`, `/api/timeline/`) so that decomposing into services later is a matter of routing, not restructuring code.
