# Self-hosted short link tracking

Short links embedded in social posts (for click attribution) use a self-hosted domain with a redirect endpoint and Redis-based counting — no external service like Bitly or Dub.

**Why**: Short link clicks are the primary signal for Content Touch interactions in the Customer Graph. Routing these through a third-party service would either require callbacks to reconcile data (fragile) or accept that click data lives outside SpellPaw (defeating the unified data model). Self-hosting costs a domain registration and one API route (`/<code>` resolving to a redirect). At Phase 1 scale (≤ 100 monthly active Contacts, ≤ 50 published posts), the traffic volume is trivial. The value of owning the click data — mapping every click back to a specific Post and Contact — is the foundation of the Customer Graph's cross-channel reasoning.

**Considered alternative**: Using an external short link service with webhook callbacks. Rejected because it introduces a third-party dependency for the most critical data pipeline in the product and creates a reconciliation gap whenever a webhook is missed.
