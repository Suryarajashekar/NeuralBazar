# Enterprise Identity Security Audit

Audit date: 2026-08-04  
Scope: wallet/SIWE authentication, sessions, identity profiles, username lifecycle, role/permission enforcement, support workflows, admin APIs, public profile privacy, and security logging.

## Result

The implementation is additive and preserves the existing wallet-first authentication and marketplace routes. Canonical enterprise roles are enforced through a permission matrix, while legacy `buyer` and `admin` values remain accepted. Role changes take effect on the next protected request because the server reloads the current database role instead of trusting JWT role data.

## Controls reviewed

- SIWE domain, URI, chain ID, nonce, and signature checks remain in the existing authentication flow.
- Login creates a stable username, records `last_login_at` and `last_active_at`, and rejects inactive accounts.
- Username validation is normalized, reserved-name aware, case-insensitive, unique, and protected by a 30-day change window.
- Previous usernames are retained as redirects instead of being silently recycled.
- Public profile output hides wallet addresses unless the owner, authorized staff, or profile privacy explicitly permits them.
- Customer, creator, support, moderator, and super-admin permissions are explicit and inherited only upward.
- Moderators cannot grant roles or read financial settings; support admins cannot moderate or manage roles; super admins cannot delete audit records.
- Managed API keys return their secret once, store only a hash, require signed requests, support revocation, and participate in nonce replay protection.
- Audit, admin, and authentication records have database triggers that reject update/delete operations.

## Residual risks

1. `schema.sql` is a rerunnable schema script rather than a versioned migration system. Use a controlled migration runner with advisory locking in production.
2. Public profile media URLs are external URLs; production should use an allowlisted media proxy or signed asset delivery policy.
3. The default in-memory rate limiter and abuse detector are process-local. Use a shared limiter/WAF for multi-instance deployment.
4. Append-only triggers protect the application database tables but not backups or a database superuser. Ship logs to a separate restricted sink with retention and alerting.
5. Support tooling intentionally exposes sensitive account data to support roles. Use least-privilege database roles, ticket-level access controls, and monitored operator access before production.

## Verification

- Backend TypeScript build: passed.
- Frontend TypeScript lint: passed.
- Frontend production build: passed.
- Focused identity tests cover role aliasing, permission boundaries, username normalization/reserved names, and the 30-day change window.
- `git diff --check`: passed.

## Deployment gate

Apply the schema from the repository root, rebuild both workspaces, restart the backend, and then verify wallet login, account switching, profile redirect, role changes, support access, moderator denial of financial APIs, super-admin audit access, API-key revocation, and session invalidation in staging.

