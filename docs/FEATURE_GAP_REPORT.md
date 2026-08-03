# NeuralBazaar Feature and Enterprise Gap Report

The current application covers the core classroom flow: wallet sign-in, role-aware dashboards, model metadata/listings, ratings, moderation, contract purchase events, and a local/Sepolia deployment path.

## Present today

- Buyer, creator, moderator, and admin roles.
- SIWE-style wallet authentication with session cookies.
- Model registry, marketplace, and access-manager contracts.
- IPFS/Pinata metadata and model upload endpoints.
- Searchable model/listing database projection.
- Creator and buyer dashboards.
- Admin user role management and moderation screens.
- Ratings and reports.
- Local Hardhat deployment path for demos without Sepolia ETH.
- Enterprise upload security gate with SHA-256, heuristic/ClamAV scanning, encrypted staging, Ed25519 signed manifests, provenance, risk scores, and verified-safe publication enforcement.
- Verified-purchase review metadata, creator reputation, safe benchmark queue/leaderboard, semantic discovery baseline, version records, wishlist/collection/follow/notification primitives, analytics, Prometheus health/metrics, organizations, and research artifact registries.

## Missing or incomplete for an enterprise release

### Trust and AI integrity

- Full framework-aware malware/dependency scanning and isolated inference execution.
- Signed model-card attestations with external legal/ownership verification.
- Versioned releases tied to a dedicated on-chain version registry.
- Completed benchmark measurements from an independently reviewed sandbox.
- Optional watermarking, stolen-model similarity checks, and explainability artifacts.

### Marketplace

- Encrypted/private asset delivery with expiring signed URLs.
- Rich frontend screens for all wishlist/follow/collection/notification/recommendation feeds.
- Purchase receipts, license acceptance records, refunds/disputes, and tax/accounting exports.
- Creator payout ledger and royalty reconciliation.
- Version-aware ratings and verified-purchase badges.

### Enterprise

- SSO/SAML/OIDC, delegated wallets, quota enforcement, and billing reconciliation.
- API key management, request signing, usage quotas, and usage billing.
- Audit log, login/device history, data export, retention, and deletion workflows.
- SSO/SAML/OIDC if institutional users are required.

### Research and operations

- Benchmark leaderboards exist; reproducible experiment evidence still needs external runners and signed artifacts.
- Federated learning coordination, differential privacy, or zero-knowledge verification (research scope, not a quick UI feature).
- Prometheus/Grafana dashboards, distributed tracing, Sentry-equivalent error tracking, and on-call alerting.
- Separate indexer, scan worker, notification worker, and scheduled reconciliation jobs.

## Prioritization

P0 security and access-control gaps must be closed before feature expansion. P1 marketplace and enterprise features can follow after the storage and session model is stable. Research features should be isolated behind explicit threat models and benchmark criteria; they should not be marketed as security guarantees until independently validated.
