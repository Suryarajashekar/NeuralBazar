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

## Missing or incomplete for an enterprise release

### Trust and AI integrity

- SHA-256 model provenance and reproducible upload manifests.
- Malware, unsafe serialization, archive traversal, and dependency scanning.
- Signed model cards and creator attestations.
- Versioned model releases with immutable parent/version relationships.
- Benchmark result verification and reproducible evaluation metadata.
- Optional watermarking, stolen-model similarity checks, and explainability artifacts.

### Marketplace

- Encrypted/private asset delivery with expiring signed URLs.
- Wishlist, follows, collections, notifications, recommendations, and trending feeds.
- Purchase receipts, license acceptance records, refunds/disputes, and tax/accounting exports.
- Creator payout ledger and royalty reconciliation.
- Version-aware ratings and verified-purchase badges.

### Enterprise

- Organizations, team membership, delegated wallets, and granular permissions.
- API key management, request signing, usage quotas, and usage billing.
- Audit log, login/device history, data export, retention, and deletion workflows.
- SSO/SAML/OIDC if institutional users are required.

### Research and operations

- Benchmark leaderboards and reproducible experiment records.
- Federated learning coordination, differential privacy, or zero-knowledge verification (research scope, not a quick UI feature).
- Prometheus/Grafana dashboards, distributed tracing, Sentry-equivalent error tracking, and on-call alerting.
- Separate indexer, scan worker, notification worker, and scheduled reconciliation jobs.

## Prioritization

P0 security and access-control gaps must be closed before feature expansion. P1 marketplace and enterprise features can follow after the storage and session model is stable. Research features should be isolated behind explicit threat models and benchmark criteria; they should not be marketed as security guarantees until independently validated.
