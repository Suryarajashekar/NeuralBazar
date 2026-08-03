# Performance and Scalability Report

## Implemented baseline

- Public model responses use additive database indexes for security status, trending score, categories, search vectors, benchmark history, activity, versions, notifications, API usage, and research artifacts.
- Search uses a bounded candidate query and deterministic local vectors. Public responses advertise short cache windows where safe.
- Model delivery remains streamed through AES-GCM decryption; the API does not buffer full model files.
- Request latency, status, error, and uptime counters are exposed in Prometheus text format. `/health/live` supports process checks and `/health/ready` checks PostgreSQL.
- Benchmark processing is moved to a separate worker, preventing long-running evaluation from blocking request handlers.
- Pagination/limits are bounded in new list endpoints and existing moderation endpoints.

## Production scale requirements

The current in-process rate/abuse maps and deterministic embedding fallback are appropriate for a single service or staging environment. Before multi-replica or multi-region deployment, add Redis (or an equivalent shared store) for rate limits, idempotency, cache, and queues; a durable queue with dead letters; PgBouncer/read replicas; object storage/private gateway delivery; and OpenTelemetry export to the organization's collector.

Do not scale the chain indexer horizontally without finality depth, reorg reconciliation, event identity by transaction/log index, and a singleton access-grant policy.

