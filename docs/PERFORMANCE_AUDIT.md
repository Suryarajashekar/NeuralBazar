# NeuralBazaar Performance and Scalability Audit

## Current bottlenecks

| Component | Current behavior | Impact | Target direction |
|---|---|---|---|
| Upload API | Disk-stages and streams the source hash/encryption, then scans and pins synchronously. | Large scans/pinning still occupy a request and need queueing at scale. | Separate durable scan/pin queue with status polling and object-storage staging. |
| Public model search | Existing compatibility route uses relational filtering; the additive semantic route uses PostgreSQL full-text plus bounded local-vector ranking. | Catalog-scale relevance and deep-page costs still need cursor pagination. | Keyset pagination, shared cache, and a reviewed embedding provider. |
| Indexer | Runs as a separate worker but still scans an unbounded `fromBlock` to `toBlock` range. | RPC limits, reorg handling, and replay recovery remain operational risks. | Finality window, bounded ranges, event identity, job/outbox records. |
| Purchase access | Sends one access-grant transaction at a time from the indexer. | A single failed grant delays the whole block and increases wallet nonce contention. | Durable grant queue, retries with backoff, dead-letter queue, reconciliation job. |
| Database | Search, ratings, admin reports, and analytics share the primary connection pool. | Noisy-neighbor behavior and connection pressure. | Query-specific indexes, pool budgets, read replica for search/analytics, pre-aggregates. |
| Frontend | Client-side data fetches lack a shared cache and request cancellation strategy. | Repeated navigation fetches and slower perceived transitions. | TanStack Query or equivalent, stale-time policies, pagination, route-level loading states. |

## Recommended capacity controls

- Set explicit limits for request body, upload bytes, concurrent uploads per account/IP, and Pinata retries.
- Use a bounded worker queue so uploads and scanning cannot consume all API resources.
- Use cursor pagination for models, ratings, purchases, reports, and admin tables.
- Add composite indexes for model status/category/created time, active listings, on-chain IDs, and purchase ownership.
- Keep numeric blockchain identifiers as strings or `bigint`; never convert arbitrary uint256 values to JavaScript `number`.
- Batch indexer reads by a configurable block span and persist progress after each successful batch.
- Cache read-only model cards and rating summaries with explicit invalidation after moderation or rating writes.
- Separate API, indexer, scan worker, and scheduled reconciliation processes before horizontal scaling.

## Load-test scenarios

The following tests should be required before a public launch:

1. 100 concurrent rejected uploads at the configured maximum size: process memory must remain bounded.
2. 50 concurrent model searches with realistic catalog cardinality: p95 latency and database pool saturation must be recorded.
3. Indexer replay across a 100,000-block range: bounded RPC calls, resumability, and no duplicate purchases.
4. Repeated purchase-event delivery: exactly one purchase row and one effective access grant.
5. Provider outage during access grant: the API remains available, jobs retry, and the failed grant is visible in admin operations.
6. Frontend navigation under slow RPC and API conditions: loading/error states remain usable and no duplicate wallet prompts appear.

## Observability thresholds

Start with alerts for:

- indexer lag greater than 20 blocks on Sepolia or the configured finality window on mainnet;
- any access-grant dead-letter job;
- upload rejection/error rate above 5% over 10 minutes;
- database pool utilization above 80% for 5 minutes;
- API p95 latency above 750 ms for reads or 2 seconds for writes;
- repeated SIWE verification failures by wallet or IP;
- marketplace pause state changing outside a planned maintenance window.
