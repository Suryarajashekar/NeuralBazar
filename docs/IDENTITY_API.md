# Identity and Administration API

All mutating browser requests use the existing CSRF flow. JSON request bodies are validated with Zod and errors use the existing safe error envelope.

## Public identity

```text
GET  /api/users/:username
GET  /api/profile/:username
GET  /api/users/:username/followers
GET  /api/users/:username/following
GET  /api/users/search?q=alice
```

An old username returns a redirect payload with `redirectUsername` and `url`. The response is privacy-filtered and includes the canonical role, badges, verification state, creator statistics, and an optional wallet address.

## Signed-in profile and follows

```text
GET    /api/users/profile
PATCH  /api/users/profile
POST   /api/users/:username/follow
DELETE /api/users/:username/follow
```

Profile updates support `username`, `displayName`, `bio`, `avatarUrl`, `bannerUrl`, `ensName`, `website`, social links, organization, location, favorite categories, and `profileVisibility`. Username changes are rate-limited by the 30-day policy.

## Administration

```text
GET  /api/admin/dashboard
GET  /api/admin/creators
GET  /api/admin/audit
GET  /api/admin/verification
POST /api/admin/users/:id/suspend
POST /api/admin/users/:id/ban
POST /api/admin/users/:id/verify
```

Support workflows include `/api/admin/support/users/:username`, purchase/download lookup, and `/api/admin/support/tickets`. Super-admin-only settings, announcements, and managed signed API keys are available under `/api/admin/settings`, `/api/admin/announcements`, and `/api/admin/api-keys`.

## Managed API keys

`POST /api/admin/api-keys` returns the complete `id.secret` value once. Only the SHA-256 secret hash is stored. Each request must include the existing timestamp, nonce, and HMAC signature headers. `DELETE /api/admin/api-keys/:id` revokes a key without deleting its audit history.

