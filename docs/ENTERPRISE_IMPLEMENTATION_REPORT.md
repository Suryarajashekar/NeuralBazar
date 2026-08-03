# NeuralBazaar Enterprise Implementation Report

Audit date: 2026-08-04

This report records the additive enterprise capabilities implemented around the existing marketplace. Existing wallet login, model registration, listings, purchases, royalties, access checks, and download routes were retained.

## Capability map

| Area | Implementation | Safety boundary |
|---|---|---|
| Upload trust | streamed SHA-256, suspicious-content scan, ClamAV hook, encrypted staging, tamper comparison | unsafe files are rejected before pinning |
| Signed provenance | Ed25519 canonical manifest and provenance JSON | production signing key is mandatory |
| Publication gate | verified-safe status, score threshold, signature/hash/owner checks | creator and moderation publication paths share the gate |
| Reviews/trust | verified-purchase flag, reportable reviews, creator reputation/trust score | reviewer wallets remain private in public responses |
| Evaluation | queued benchmark runs and separate worker | uploaded code is not imported or executed |
| Discovery | PostgreSQL full-text search plus deterministic local embedding baseline | embedding provider is replaceable via service boundary |
| Marketplace growth | recommendations, activity, wishlists, collections, follows, notifications, featured items | session-bound writes use UUID-backed user identity |
| Lifecycle | model versions, release notes, comparison and activation | rollback changes the primary artifact only when a safe attached manifest exists |
| Operations | Prometheus text metrics, live/readiness health, API usage records | no payloads or credentials are persisted |
| Enterprise | organizations, RBAC membership, projects, billing events, API usage | quotas/billing reconciliation remain deployment work |
| Research | artifact registry, cross-chain records, DAO proposals, compute listings | registry entries are not claims of external proof execution |

## New API groups

- `/api/reputation`
- `/api/benchmarks`
- `/api/search/semantic`, `/api/recommendations`, `/api/trending`, `/api/activity/*`
- `/api/versioning`
- `/api/wishlist`, `/api/collections`, `/api/follow`, `/api/notifications`, `/api/featured`
- `/api/analytics`
- `/api/organizations`
- `/api/research`
- `/metrics`, `/health/live`, `/health/ready`

All request bodies in these additions are parsed with Zod. Existing response fields remain available; new security, provenance, reputation, and analytics fields are additive.

## Explicit non-goals

The repository does not execute arbitrary uploaded model code, claim that heuristic scanning proves safety, silently mark legacy rows as verified, introduce a new payment flow, or modify existing marketplace economics. Production inference benchmarking requires a separately isolated runner with its own image, credentials, network policy, resource limits, and independent review.

