# NeuralBazaar Security Audit

Audit date: 2026-08-03  
Review type: static repository review plus local build/test verification  
Scope: Solidity contracts, Express API, PostgreSQL access, IPFS upload/access flow, Next.js wallet/auth flow, and deployment configuration

## Executive summary

NeuralBazaar has a workable Sepolia/local-demo foundation and several useful controls already in place: SIWE-style wallet authentication, one-time nonces, HttpOnly session cookies, backend role checks, Helmet, CORS allow-listing, request-size limits, Solidity reentrancy protection, pausing, royalty accounting, and idempotent purchase writes.

It is not yet safe to expose as a public model marketplace. The highest-risk issues are:

1. Model uploads use `multer.memoryStorage()` with a 2 GB limit, allowing a single request to exhaust API memory.
2. Model files are pinned to a public gateway and the access endpoint returns a raw gateway URL, so paid access is not enforceable for already-known CIDs.
3. The API trusts a client-supplied on-chain model ID when saving metadata and does not prove that the connected creator owns that token.
4. The contracts rely on a single `Ownable` key, have listing/ownership synchronization gaps, and push payments to arbitrary recipients.
5. The indexer runs in the web process, scans an unbounded block range, does not handle reorg finality, and submits access grants sequentially.

These issues should be addressed before accepting real uploads or real funds. Existing Sepolia contracts should not be edited in place; the contract fixes belong in a reviewed V2 deployment with an explicit migration plan.

## Verification performed

- Contract compilation completed with the repository's Cancun compiler configuration.
- Backend TypeScript build and lint completed.
- Existing Hardhat test command completed without a visible failure.
- The frontend dependency tree has previously shown an incomplete local `viem` type package; reinstalling the locked dependencies should be part of the frontend verification gate.

This is not a formal third-party smart-contract audit. No private keys, production database, live RPC state, or deployed bytecode were inspected.

## Implemented in this hardening pass

- Uploads now use disk-backed staging instead of buffering the full file in Node memory.
- Upload size and multipart-file count are bounded by configuration.
- Model bytes are streamed to Pinata and a SHA-256 digest/byte length is returned as provenance.
- Staged files are removed after the Pinata attempt, including error paths.
- Uploads have a dedicated rate limit and multipart errors return safe status messages.
- Unknown backend errors now return HTTP 500 without exposing internal error text.
- The model persistence route verifies the on-chain creator and requires the submitted IPFS/metadata references to match the registry.
- Model files are now encrypted before Pinata pinning; access delivery is chain-gated and decrypt-streamed by the API.
- Production configuration requires a model encryption key and ClamAV path; V2 contracts provide multisig-admin roles, separated access grants, ownership-aware listings, and pull payments.
- The web API no longer starts the indexer; `start:worker` is the dedicated worker entry point, and server sessions are revocable in PostgreSQL.

The scanner is a heuristic layer plus optional ClamAV. Production must configure ClamAV; archives and model formats still require independent security review before accepting arbitrary untrusted workloads.

## Trust boundaries

```text
Wallet/signature ──> Next.js browser ──cookie/session──> Express API ──> PostgreSQL
       │                    │                              │
       └──── transactions ──┴──────────────> EVM contracts │
                                      └────> Pinata/IPFS  │
                                      └────> indexer/worker
```

The chain is authoritative for ownership, listing, payment, and purchase events. PostgreSQL is a searchable projection and stores user/profile data. IPFS content is immutable but is not automatically private; a CID is a public locator unless the content is encrypted or served through a controlled gateway.

## Findings

### Critical / P0

| ID | Area | Finding | Evidence | Required treatment |
|---|---|---|---|---|
| API-001 | Uploads | A request can allocate up to 2 GB in process memory before the API responds. | `backend/src/routes/uploads.ts` uses `multer.memoryStorage()` and a 2 GB `fileSize` limit. | Move to disk/object-storage staging, enforce a conservative edge limit, stream hashing, and scan in an isolated worker. |
| DATA-001 | Paid access | The upload service pins model bytes and the access route can return a public Pinata gateway URL. Anyone who obtains the CID can bypass the API. | `backend/src/services/pinata.ts`, model access route, and on-chain `ipfsHash` storage. | Encrypt paid model archives or use private object storage/private gateway delivery with short-lived signed URLs. Never expose the raw gateway URL. |
| API-002 | Creator authorization | Metadata persistence accepts `modelIdOnchain` from the request without verifying registry ownership/creator identity. | `backend/src/routes/models.ts`. | Read `ownerOf` and registry creator from the chain, require the authenticated address to match the permitted creator, and reject mismatches before the database upsert. |
| SC-001 | Contract governance | A single owner controls pause, fees/treasury, and access grants. Compromise of that key is a platform-wide compromise. | `AIModelMarketplace.sol`, `AccessManager.sol`, and `AIModelRegistry.sol` inherit `Ownable`. | Use a multisig plus timelock for administrative actions; separate access-grant operator from financial governance; document emergency recovery. |

### High / P1

| ID | Area | Finding | Evidence | Required treatment |
|---|---|---|---|---|
| SC-002 | Listings | A listing snapshots the seller. If the ERC-721 is transferred after listing, payment may go to the old seller and the new owner cannot manage the listing. Multiple active listings can also exist for one model. | `contracts/contracts/AIModelMarketplace.sol`. | Enforce one active listing per model, re-check ownership on buy/update/cancel, and cancel or invalidate listings on transfer. Add invariant tests. |
| SC-003 | Payments | `buyModel` pushes ETH to seller, creator, and treasury. A recipient contract that reverts can block purchases. | Low-level recipient calls in `AIModelMarketplace.sol`. | Use pull-payment balances or a withdrawal queue, with bounded accounting and emergency pause. |
| SC-004 | Registry policy | The original creator can update metadata after model ownership changes, while ownership transfer is not coordinated with listings. | `AIModelRegistry.sol`. | Define creator-versus-owner rights explicitly, emit transfer/provenance events, and make marketplace state react to transfers. |
| API-003 | Upload integrity | Extension/MIME validation is not a malware, archive, unsafe-serialization, or miner scan. Pickle-like formats can contain executable payloads when loaded by unsafe tooling. | `backend/src/routes/uploads.ts` and Pinata service. | Quarantine first, validate magic bytes, reject path traversal, scan archives and unsafe serialization, and publish only after review. |
| API-004 | Ratings/reports | Ratings accept arbitrary target keys and do not require a purchase or creator relationship. Reports can be spammed. | `backend/src/routes/ratings.ts` and report route. | Resolve target IDs server-side, enforce one rating per eligible user/version, verify purchase where appropriate, add abuse throttles and moderation status. |
| IDX-001 | Indexing | Indexer runs in the API process, scans the entire range in one RPC query, advances state only at the end, and grants access sequentially. | `backend/src/services/indexer.ts`. | Move to a singleton worker/queue, batch block ranges, add retries and dead-letter records, persist event identity, and wait for confirmations. |
| IDX-002 | Indexing correctness | Event IDs are converted with `Number()`, which is unsafe for arbitrary uint256 values. Reorgs and ownership/metadata events are not reconciled. | `backend/src/services/indexer.ts`. | Keep IDs as decimal strings/bigints, use transaction-log identity, process finalized blocks, and add reconciliation. |
| AUTH-001 | Sessions | A stolen seven-day bearer JWT remains valid after logout because there is no server-side session revocation or refresh-session record. | `backend/src/middleware/auth.ts` and auth routes. | Use short-lived access sessions plus a hashed rotating refresh/session record, revoke on logout, and support device/session listing. |
| AUTH-002 | Authentication abuse | Nonce and verify endpoints share the global rate limit; there is no wallet/IP-specific attempt budget or explicit issued-at policy beyond basic expiry. | `backend/src/routes/auth.ts` and `backend/src/server.ts`. | Add dedicated auth rate limits, nonce binding, clock-skew rules, replay tests, and structured security events. |
| API-005 | Error handling | The global error handler returns `error.message`, which can expose provider, database, or internal implementation details. Unexpected errors are treated as client errors. | `backend/src/server.ts`. | Return stable error codes to clients, log detailed errors privately, and use HTTP 500 for unknown failures. |

### Medium / P2

| ID | Area | Finding | Treatment |
|---|---|---|---|
| WEB-001 | Browser security | The frontend has no explicit CSP and contract configuration can fall back to zero addresses, creating confusing or unsafe transaction behavior. | Add a report-only CSP, then enforce it; fail fast when production contract addresses are missing or zero. |
| DB-001 | Database | The migration is a single multi-statement script without versioning/locking. Public search lacks full-text/trigram indexes and several high-cardinality query paths need composite indexes. | Introduce numbered migrations with an advisory lock, add query-driven indexes, and test rollback/forward compatibility. |
| DB-002 | Privacy | Profiles and transaction metadata rely on database/provider encryption rather than field-level minimization and explicit retention rules. | Minimize stored personal data, document retention, and encrypt sensitive fields when required by the deployment. |
| OPS-001 | Observability | There are no request IDs, metrics, tracing, Sentry-equivalent error tracking, or alert thresholds. | Add structured logs, Prometheus-compatible metrics, error tracking, and alerts for auth failures, upload rejects, indexer lag, and grant failures. |
| SUP-001 | Supply chain | The project depends on a large Web3 stack and local dependency state has shown an incomplete `viem` package. | Lock and verify dependencies in CI, run `npm audit`/OSV scanning, use reproducible installs, and pin container/runtime versions. |

## Controls already present

- SIWE message verification checks domain, URI, chain ID, nonce, and expiration.
- Nonces are single-use and stored server-side.
- Session cookies are HttpOnly and use secure cross-site settings in production.
- Backend role checks protect admin and moderator routes; frontend checks are not treated as authorization.
- Helmet, CORS, JSON limits, and a mutating-origin check are enabled.
- Solidity marketplace purchases use `nonReentrant`, checks-effects-interactions ordering, and pausing.
- Purchase persistence uses the transaction hash as an idempotency key.

These controls reduce risk but do not remove the P0 findings above.

## Prioritized implementation plan

### Phase 0 — immediate guardrails

1. Keep secrets out of git and CI logs.
2. Replace memory-bound uploads with staged files and a hard deployment-specific limit.
3. Add SHA-256 provenance, MIME/magic validation, quarantine status, and a scan result to the upload pipeline.
4. Hide removed/flagged models from public queries.
5. Add strict production configuration validation for RPC, contract addresses, admin wallet, and private gateways.

### Phase 1 — access and identity

1. Add server-side session records, short access lifetimes, refresh rotation, revocation, and device history.
2. Add per-IP/per-wallet auth throttles and security audit events.
3. Verify model ownership and creator identity from the chain before writing metadata.
4. Add purchase-gated ratings, report deduplication, and moderation audit trails.

### Phase 2 — contract V2

1. Have the contracts independently reviewed and fuzz/invariant tested.
2. Move administration to multisig/timelock and separate operational access grants.
3. Enforce listing/ownership invariants and pull payments.
4. Deploy V2 to Sepolia, migrate only after testnet reconciliation, then plan mainnet deployment.

### Phase 3 — scale and operations

1. Run the indexer as a separate single-instance worker with a queue and dead-letter handling.
2. Add finality/reorg handling, event reconciliation, metrics, tracing, and alerting.
3. Add PostgreSQL migrations, search indexes, cursor pagination, caching, and background upload/scan jobs.

## Release gates

Do not accept public model uploads until API-001, DATA-001, API-002, and API-003 are closed. Do not accept mainnet funds until SC-001 through SC-004 have been reviewed and tested with a multisig policy.
