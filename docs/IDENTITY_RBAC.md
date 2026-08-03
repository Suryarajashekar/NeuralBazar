# Enterprise Identity and RBAC

NeuralBazar keeps the connected wallet as the unique blockchain identity. The new identity layer adds a public username and profile without replacing SIWE, wallet ownership, sessions, or marketplace ownership checks.

## Roles

| Role | Scope |
|---|---|
| Customer | Browse, purchase, download, wishlist, review, and follow creators. |
| Creator | Customer permissions plus model upload/version management and creator analytics. |
| Support Admin | Customer permissions plus support profile, purchase/download, ticket, username-reset, and notification workflows. It cannot manage roles, finance, or moderation content. |
| Moderator | Support permissions plus content/report moderation, suspensions, and creator verification. It cannot manage roles or financial settings. |
| Super Admin | Full platform administration, audit access, settings, announcements, API-key management, moderation, and financial analytics. |

`buyer` and `admin` remain accepted as legacy aliases. They normalize to `customer` and `super_admin` in permission checks, so existing records and API keys continue to work. New wallet sign-ins use the canonical roles `customer` and `super_admin`.

## Username lifecycle

- Usernames are 3–30 characters, case-insensitive, and may contain letters, numbers, `.`, `_`, and `-`.
- Reserved operational names cannot be claimed.
- A new wallet receives a deterministic collision-safe `user_<address-prefix>` username.
- A user can change a username once every 30 days.
- Old names are stored in `username_history`; public profile API requests return a redirect payload for old URLs.
- The wallet remains available to the owner and authorized support staff; public profiles hide it unless profile privacy permits it.

## Profile routes

- `/profile/{username}` and `/user/{username}` are public profile pages.
- `/settings/profile` manages the signed-in profile.
- `GET /api/users/{username}` and `GET /api/profile/{username}` return the same privacy-filtered profile.
- `PATCH /api/users/profile` updates the signed-in profile.
- Follower/following collections are available below the username resource.

## Enforcement

Protected backend routes still use the existing `requireAuth` boundary. `requireRole` now compares canonical roles, and new administrative routes use explicit permissions from `backend/src/services/identity.ts`. The server reloads the current role from PostgreSQL on every session request rather than trusting a stale JWT role claim. Suspended, banned, and deleted accounts cannot create or refresh active sessions.

Audit, admin, and authentication logs are append-only at the database trigger layer. There are no delete APIs for those records.

