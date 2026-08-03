# NeuralBazaar Enterprise Roadmap

This is the staged implementation order derived from the audit. Each stage should ship with tests, metrics, and a rollback note before the next stage begins.

## Phase 0 — guardrails

- Secret and artifact hygiene.
- Strict environment validation.
- Upload size/concurrency limits.
- Stable API error codes and request IDs.
- Dependency and contract build checks in CI.

## Phase 1 — secure identity and content

- Server-side sessions with rotation/revocation.
- Per-route authentication, upload, and admin rate limits.
- Disk/object-storage upload staging.
- SHA-256 provenance and quarantine/scanning status.
- Private/encrypted paid assets and signed delivery.
- Chain ownership verification before metadata writes.

## Phase 2 — contract V2 and economic safety

- Multisig/timelock administration.
- Separate operational access-grant role.
- One-listing-per-model and transfer-aware listing state.
- Pull payments and withdrawable balances.
- Fuzz, invariant, malicious-recipient, pause, and reentrancy tests.

## Phase 3 — scalable data plane

- Versioned migrations and query-driven indexes.
- Cursor pagination and full-text/trigram search.
- Separate indexer/scan/notification workers.
- Queue retries, dead-letter records, finality/reorg handling, and reconciliation.
- Redis/cache policy and read replicas only after measuring the primary bottleneck.

## Phase 4 — marketplace and enterprise

- Verified-purchase ratings, creator reputation, wishlist/follows, collections, notifications, and recommendations.
- Versioned model releases, benchmarks, license acceptance, receipts, and payout reporting.
- Organizations, delegated wallets, API keys, quotas, usage billing, audit logs, device history, and data lifecycle controls.

## Phase 5 — research and operations

- Reproducible benchmark leaderboards.
- Optional federated learning, differential privacy, explainability, and zero-knowledge research modules with separate threat models.
- Prometheus/Grafana, tracing, error tracking, SLOs, alerting, and incident runbooks.
