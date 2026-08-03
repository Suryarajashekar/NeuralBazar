# NeuralBazaar Security Audit Report

Audit date: 2026-08-04
Review type: static repository review, additive hardening, and local build/test verification
Scope: tracked root repository source, Solidity contracts, Express API, PostgreSQL schema, Next.js client, deployment configuration, and the legacy nested snapshot observed during inventory

This report is an engineering security review, not a substitute for an independent smart-contract audit, production penetration test, malware-scanning validation, or cloud configuration review. No production keys, live database, deployed bytecode, or external services were accessed.

## Executive summary

The repository now has a backward-compatible security layer covering contract authorization, incident response, signed authorization replay protection, session lifecycle, browser request integrity, API abuse controls, request validation, security telemetry, and an enterprise model-publication security gate. Uploaded model bytes are hashed, heuristically inspected, optionally scanned by ClamAV, integrity-checked during encryption, signed in a manifest, and blocked from publication unless the configured score threshold is met.

Existing marketplace routes and legacy contract entry points remain available. New production contract deployments should use the secure deployment path (`deploy:secure`) rather than treating historical `Ownable` deployments as patched in place.

## Repository inventory and trust boundaries

The tracked root is the active monorepo:

- `contracts/`: ERC-721 registry, legacy marketplace/access contracts, V2 role-controlled marketplace/access contracts, and deployment scripts.
- `backend/`: Express API, PostgreSQL projection, encrypted upload/access pipeline, and separate indexer worker.
- `frontend/`: Next.js wallet UI and cookie-based SIWE client.
- `docs/`: deployment and engineering reports.

The workspace also contains an ignored nested `decentralized-ai-marketplace/` snapshot and an untracked ZIP archive. They were inspected as legacy copies but were not modified because they are not tracked build inputs. The nested snapshot lacks the root hardening additions and must not be deployed as an alternative source tree.

Primary trust boundaries:

```text
Wallet/SIWE signature -> Next.js browser -> HTTPS API -> PostgreSQL
       |                       |               |\
       |                       |               | -> Pinata/private gateway
       |                       |               | -> singleton indexer worker
       |                       v
       +------------------> EVM contracts -> purchase/access events
```

## Implemented controls

### Smart contracts

- `AIModelMarketplaceV2` retains `ReentrancyGuard`, `Pausable`, and `AccessControl`.
- `NeuralBazaarTimelock` adds an OpenZeppelin `TimelockController` with a one-day minimum delay and self-administered governance.
- `AIModelMarketplaceSecure` adds a separately held `EMERGENCY_PAUSER_ROLE`; it can pause immediately, while unpausing remains a timelocked governance operation.
- `deploy-secure.ts` deploys the timelock, secure marketplace, and V2 access manager with separate governance, emergency-pauser, treasury, and backend-granter addresses.
- Marketplace funds use pull-payment balances in V2; withdrawals remain `nonReentrant` and effects occur before the external call.
- `buyModelWithAuthorization` verifies EIP-712 typed data with the contract/chain domain, deadline, buyer address, and a per-buyer nonce. The nonce is consumed on success and prevents replay.
- Existing direct `buyModel`, listing, and access-manager calls remain available for compatibility.
- Registry metadata updates now emit an additional actor/previous-value event without removing the existing event.
- Listing IDs and model IDs use unchecked monotonic increments where overflow is unreachable under the platform's practical limits; the compiler optimizer remains enabled.

### Backend and authentication

- Access JWTs are short-lived by default (15 minutes); rotating refresh tokens are stored only in an HttpOnly cookie and only their SHA-256 hashes are stored in PostgreSQL.
- Refresh rotation updates the access hash and refresh hash, preserving server-side revocation. Logout and individual-session deletion revoke sessions.
- Sessions track device ID, user agent, IP, creation time, last-seen time, maximum lifetime, and idle timeout.
- `/api/auth/sessions` exposes device/session inventory and `/api/auth/login-history` exposes the authenticated wallet's login history without exposing tokens.
- Existing `neuralbazaar_session` cookie and existing authentication routes remain. Legacy sessions without a refresh hash continue to work until their existing expiry; new sign-ins receive the stronger lifecycle.
- Cookies are HttpOnly, Secure in HTTPS deployments, SameSite-aware, path-scoped, and high priority. The refresh cookie is separate from the access cookie.
- SIWE domain, URI, chain, nonce, and expiration checks remain enforced; nonces are deleted after successful verification.
- API errors now return stable safe messages/codes and request IDs. Internal database/provider details are logged server-side only.

### API security

- Helmet is configured with deny-by-default API CSP directives, referrer protection, HSTS in production, and explicit cross-origin behavior.
- CORS is restricted to the configured frontend and explicitly allows only required methods and security headers.
- A double-submit CSRF token is issued by `/api/auth/csrf`; cookie-authenticated mutations require `X-CSRF-Token` plus an allowed Origin/Referer. Bearer and signed API-key requests do not rely on browser cookies.
- Global IP rate limiting remains enabled, with dedicated authentication, upload, rating, and report limits.
- An in-memory abuse detector counts repeated 401/403/429 responses per IP, temporarily blocks repeated authentication abuse, and writes threshold events to audit logs. A production deployment should pair this with a WAF or distributed limiter.
- Machine clients may use `X-API-Key` values configured in `API_KEYS`. Every API-key request must include a timestamp, unique nonce, and HMAC-SHA256 request signature over method, URL, body digest, timestamp, and nonce.
- API request nonces are persisted with a uniqueness constraint, so a valid signed request cannot be replayed.
- Zod validation is used for authentication, route parameters, marketplace metadata, moderation, ratings, reports, and existing body schemas. Validation failures are normalized without stack traces or database messages.
- Production contract address configuration fails fast on zero addresses; uploads remain disk-staged, scanned, encrypted, and streamed rather than buffered in process memory.

### Uploaded-model security and provenance

- `backend/src/services/modelScanner.ts` streams SHA-256 while checking executable magic bytes, pickle opcodes, arbitrary code execution, suspicious imports, shell/reverse-shell payloads, archive traversal, encoded payload markers, crypto-mining indicators, and basic watermark/model-card markers.
- `.pt` and `.pth` pickle-based PyTorch uploads are rejected. Production additionally requires `CLAMAV_PATH`; development mode reports the missing scanner as a medium finding rather than silently claiming a clean malware scan.
- Safe uploads are encrypted only after the source digest is complete. The source digest must match the scanner digest before pinning; AES-256-GCM authentication protects delivery-time tampering.
- `modelSecurity.ts` creates an Ed25519-signed canonical manifest containing owner, original/encrypted SHA-256 values, file length, scanner, score, status, watermark signal, and timestamp. Production signing keys are required; development uses an ephemeral key and logs a warning.
- Rejected decisions are retained as revoked upload manifests with the score, finding codes, and provenance. Rejected files are never pinned or made available to publication routes.
- `/api/models` publication validates manifest signature, owner, source/ciphertext hashes, score threshold, and `verified_safe`. Both creator status changes and the admin moderation status endpoint enforce the same rule.
- Public rows that predate the gate are labeled `legacy_unverified` for compatibility. They are not presented as newly verified. New indexed chain registrations enter `draft`/`pending` until the private upload and publication flow supplies a safe manifest.
- Model cards/API rows expose `security_score`, `security_status`, `verified_safe`, `security_report`, and `provenance`; the benchmark UI renders the verified-safe badge. A watermark marker is recorded as provenance evidence, not treated as proof of legal ownership.

### Enterprise platform security primitives

- Reputation is recomputed from verified purchase activity, downloads, ratings, and reports; reviews carry `verified_purchase` and can be reported without exposing reviewer wallets publicly.
- Benchmark requests enter `benchmark_runs` and are processed by a separate worker. The default worker only reads signed artifact metadata and returns `not_available` for inference metrics; it never imports or executes uploaded model code. An isolated, separately reviewed runner is required before enabling inference execution.
- Semantic discovery uses PostgreSQL full-text search plus a deterministic local embedding baseline. Recommendations, activity history, wishlists, collections, follows, notifications, featured items, versions, and rollback metadata are additive tables/routes.
- `/metrics`, `/health/live`, `/health/ready`, and Prometheus text counters provide request/error/latency telemetry. Organization/project/member/billing/API-usage tables provide enterprise tenancy primitives.
- Research artifacts support federated-learning, ZK ownership, differential privacy, explainability, carbon, lineage, reproducibility, cross-chain deployment, DAO proposal, and compute-listing records. These records are registries/attestations; they do not claim a ZK proof or federated computation occurred without an external verifier.

### Enterprise identity and RBAC

- Wallet/SIWE remains the unique blockchain identity; public usernames are a compatibility-preserving presentation and URL layer.
- Canonical `customer`, `creator`, `support_admin`, `moderator`, and `super_admin` roles inherit explicit permissions. Legacy `buyer` and `admin` values remain accepted and normalize to customer/super-admin behavior.
- Username allocation, reserved-name checks, case-insensitive uniqueness, 30-day changes, historical redirects, profile privacy, badges, verification, and public follower/following APIs are implemented in `backend/src/services/username.ts` and `backend/src/routes/users.ts`.
- Support tickets, creator verification requests, announcements, settings, and managed API keys are represented by additive schema tables and permission-gated admin routes.
- Managed API-key secrets are returned once and stored as SHA-256 hashes; the existing HMAC, timestamp, nonce, and replay protections apply to them.
- The server reloads the role/account status from PostgreSQL on every session-protected request. Suspended, banned, or deleted users cannot continue using an active session.
- `audit_logs`, `admin_logs`, and `authentication_logs` are protected by append-only database triggers; no application route deletes them.

### Security logging

The PostgreSQL schema now includes:

- `audit_logs` for security-relevant API mutations and abuse thresholds.
- `admin_logs` for all `/api/admin/*` requests, actor, target, result, request ID, IP, user-agent, and metadata.
- `authentication_logs` for nonce issuance, login, refresh, logout/failure HTTP outcomes, device, IP, user-agent, and failure codes.
- `api_request_nonces` for signed-request replay protection.

Logging is best-effort and never exposes secrets or blocks a marketplace response. A production deployment should ship these rows to an append-only monitored sink.

## Findings and residual risk

| ID | Severity | Finding | Current treatment / residual action |
|---|---|---|---|
| SC-LEGACY | High | Historical `AIModelMarketplace` and `AccessManager` deployments retain single-owner administration; the legacy marketplace pushes ETH. | Source remains for compatibility. Do not use for new production funds; deploy `AIModelMarketplaceSecure` and `AccessManagerV2` behind `NeuralBazaarTimelock`. Existing deployments require a migration/pause plan. |
| SC-GOV-001 | High | Timelock security depends on correct proposer/executor multisig custody and role configuration. | Secure deployment script enforces a one-day minimum and separate addresses. Independently review the Safe, timelock roles, and emergency key before mainnet. |
| API-KEY-001 | High | API key secrets are configured in process environment and have no self-service rotation endpoint. | Use a cloud secret manager, rotate by deployment, keep scopes narrow, and monitor `admin_logs`. Do not commit `API_KEYS`. |
| IDX-001 | High | The indexer still scans an unbounded block range and does not implement finalized-block/reorg reconciliation or a durable retry queue. | Run only as a singleton worker. Before public/mainnet use, add finality depth, bounded batches, event identity `(tx_hash, log_index)`, retries/dead letters, and reconciliation. |
| DATA-001 | Medium | IPFS metadata and encrypted ciphertext CIDs are public identifiers; encryption protects model bytes but not metadata or traffic to a public gateway. | Use a private gateway/object store and short-lived delivery controls in production; rotate encryption keys by documented migration. |
| CSP-001 | Medium | The frontend CSP still permits `unsafe-inline` for Next.js compatibility and broad HTTPS/WSS connectivity for wallet/RPC providers. | Move to nonce/hash-based script policy and explicit provider origins after deployment topology is fixed. |
| LOG-001 | Medium | Security logs are written asynchronously to the same PostgreSQL availability domain and are not immutable by themselves. | Add centralized append-only retention, alerting, and restricted log-reader/writer roles. |
| DB-001 | Medium | The migration remains a repeatable schema script rather than a versioned migration framework, and production SSL uses `rejectUnauthorized: false`. | Add numbered migrations/advisory locking and a verified CA bundle before production. |
| UPLOAD-001 | Medium | Heuristic plus optional ClamAV scanning cannot prove arbitrary model/archive safety. | Keep production ClamAV mandatory, quarantine untrusted formats, scan archives in isolation, and review model-loading policies. |
| TEST-001 | Medium | No backend integration, CSRF, refresh-rotation, API-signing, abuse, or database migration tests are included in this repository. | Add automated tests and a production-like staging smoke suite before launch. |
| MODEL-SEC-001 | High | Static model scanning cannot prove safety for every framework, archive, or native extension. | Production requires ClamAV and safe formats, rejected artifacts are quarantined from publication, and inference is disabled unless a separately isolated runner is reviewed. |
| MODEL-SEC-002 | Medium | Local embedding search is a deterministic fallback, not a semantic model with learned quality guarantees. | Replace `local-hash-v1` through the embedding service interface after privacy, cost, and model-supply-chain review. |
| BENCH-001 | High | A benchmark runner that imports arbitrary model code could become an RCE boundary. | The included worker deliberately returns `not_available` for inference metrics and only reads signed metadata. Treat any future runner as a separate sandboxed product. |
| ENTERPRISE-001 | Medium | Organization/API usage records do not yet enforce quota billing or distributed cache/queue semantics. | Add Redis-backed rate limits/queues, tenant quotas, billing reconciliation, and immutable log shipping before multi-region scale. |
| IDENTITY-001 | Medium | Public username/profile data introduces an additional identity enumeration surface. | Privacy-filtered profile responses, reserved names, wallet hiding, account status filtering, and rate limiting are implemented; add a dedicated search/WAF policy and privacy review before public launch. |
| RBAC-001 | High | Enterprise role safety depends on the database migration being applied before the new backend is started. | The migration is rerunnable and backward-compatible; apply it in staging, then verify role-change/session invalidation and least-privilege operator paths before production. |

## Backward-compatibility and rollout notes

1. Apply the expanded `backend/src/db/schema.sql` before starting the hardened backend. The `ALTER TABLE ... IF NOT EXISTS` additions are compatible with the current schema.
2. Existing API clients may continue using the established route names and `neuralbazaar_session` cookie. New browser clients use `/api/auth/csrf` and refresh automatically after an access-token expiry.
3. Existing bearer access remains supported; machine clients using API keys must implement the signed-request format documented below.
4. Existing legacy contract addresses are immutable historical deployments. The secure contract path is additive; switch frontend/backend addresses only after Sepolia reconciliation and access-grant smoke tests.
5. Set `ADMIN_WALLET_ADDRESS`, `MODEL_ENCRYPTION_KEY`, `CLAMAV_PATH`, `MODEL_SIGNING_PRIVATE_KEY`, `MODEL_SIGNING_PUBLIC_KEY`, and an intentional `MODEL_SECURITY_SCORE_THRESHOLD` in production. Keep `GOVERNANCE_MULTISIG`, `BACKEND_GRANTER_ADDRESS`, and `EMERGENCY_PAUSER_ADDRESS` separate.
6. Run `npm run start:benchmark-worker` as a separate service only for metadata-safe benchmark processing. Do not mount the API's filesystem, secrets, or database write credentials into a future inference sandbox.
7. Apply the identity/RBAC schema additions before login: `npm.cmd run db:migrate --workspace backend` from the repository root. Do not run workspace-qualified commands from inside `backend`.

## Signed API request format

Configure `API_KEYS` as comma-separated entries:

```text
id:32-or-more-character-secret:subject:0xWalletAddress:role
```

For each request send:

```text
X-API-Key: id.secret
X-Request-Timestamp: unix-seconds
X-Request-Nonce: 16-128 character unique value
X-Request-Signature: base64url(HMAC-SHA256(secret, canonical-string))
```

The canonical string is:

```text
timestamp.nonce.HTTP_METHOD.originalUrl.sha256(raw-request-body)
```

The timestamp is limited by `REQUEST_SIGNING_MAX_SKEW_SECONDS` and the nonce is single-use in `api_request_nonces`.

## Verification performed

- `npm.cmd run compile:contracts`: passed; 15 Solidity files compiled for Cancun and 68 TypeChain typings generated.
- `npm.cmd run test:contracts`: passed; 5 tests, including direct V2 compatibility, pull payments, roles, EIP-712 replay rejection, and emergency-pause separation.
- `npm.cmd run build --workspace backend`: passed after the enterprise routes and model gate.
- `npm.cmd run lint --workspace frontend`: passed after the benchmark/security UI additions.
- `npm.cmd run build --workspace frontend`: passed after the identity profile routes and Next.js 15 parameter updates.
- `npm.cmd run test:identity --workspace backend`: focused role/username boundary tests are included for CI/staging execution.
- `git diff --check`: passed.

The local Hardhat compiler required elevated process-spawn permission on Windows because the sandbox returned `spawn EPERM`; no deployment or network call was performed.

## Release gates

Before accepting public uploads or real funds:

1. Independently audit and fuzz the secure contracts, including timelock role transitions, emergency pause recovery, authorization nonce handling, and withdrawal accounting.
2. Deploy secure contracts to Sepolia with a real multisig, dedicated emergency operator, backend granter, and treasury; verify addresses and roles.
3. Add backend integration tests for CSRF, refresh rotation/revocation, device history, API signatures, nonce replay, rate limiting, and schema migration.
4. Run the indexer with finality/reorg protections and monitor grant failures and lag.
5. Configure private model delivery, ClamAV isolation, database TLS verification, centralized audit logging, WAF/distributed rate limiting, and alerting.
6. Perform a wallet-switch, unauthorized-role, upload rejection, purchase, access delivery, emergency pause, and recovery smoke test on staging.
