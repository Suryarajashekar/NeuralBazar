# API Security and Enterprise Reference

## Authentication

Browser mutations use the existing HttpOnly session plus `/api/auth/csrf`. Machine clients use the existing API-key HMAC scheme with timestamp, single-use nonce, and canonical request signature. Protected enterprise writes require a session-backed UUID identity; API-key principals cannot accidentally populate UUID foreign keys.

## Model security lifecycle

1. `POST /api/uploads/model` stages and scans the file.
2. The source SHA-256 is compared again while encrypting.
3. Safe artifacts receive an Ed25519-signed manifest and provenance record.
4. Rejected artifacts are revoked and never pinned.
5. `POST /api/models` validates the manifest signature, hashes, owner, score, and safe status before persistence.
6. Public models expose security metadata; legacy rows are labeled `legacy_unverified`.

## Operational endpoints

- `GET /health`, `/health/live`, `/health/ready`
- `GET /metrics`
- `GET /api/benchmarks/leaderboard`
- `GET /api/reputation/creators`
- `GET /api/search/semantic?q=...`
- `GET /api/recommendations`

## Tenant endpoints

Organizations support creation, member roles (`owner`, `admin`, `developer`, `viewer`, `billing`), projects, billing events, and usage summaries. Send `X-Organization-Id` on authenticated requests when associating usage with a workspace. The API records endpoint, status, latency, units, user, organization, and API-key ID only; it does not record credentials or payloads.

