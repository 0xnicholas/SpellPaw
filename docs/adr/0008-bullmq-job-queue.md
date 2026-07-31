# BullMQ for asynchronous job processing

Job queuing uses BullMQ backed by Redis for post publishing, Interaction ingestion, and future Campaign orchestration steps.

**Why**: Publishing a post to multiple channels is inherently asynchronous — each platform API may respond with latency, rate limits, or transient failures. A synchronous HTTP request from the Composer would block the UI for seconds and lose state on failure. BullMQ provides exactly-once delivery semantics, retry with exponential backoff, and per-channel worker isolation so that a Twitter API outage does not block LinkedIn publishing. Redis is already in the stack for caching; no additional infrastructure required.

**Considered alternatives**: In-process `setTimeout` or a simple PostgreSQL-backed job table was rejected because neither handles worker isolation, retry policies, or dead-letter queues without rebuilding BullMQ's feature set. RabbitMQ was rejected because the operational complexity of a separate message broker is unjustified for Phase 1 scale.

**Consequences**:
- Post scheduling splits into two paths: jobs within 7 days use BullMQ's native `delay` (idempotent via `jobId: "post:{id}"` — rescheduling replaces the old job); jobs beyond 7 days stay as `status=SCHEDULED` rows and are picked up by a 5-minute reconciler cron that pushes them into the publish queue when their `scheduledAt` arrives.
- Content Touch ingestion (short link clicks) also flows through BullMQ — a lightweight `clickQueue` with `removeOnComplete: true`, 3 retries, and exponential backoff — preventing silent click loss while keeping the HTTP redirect under 30ms.
