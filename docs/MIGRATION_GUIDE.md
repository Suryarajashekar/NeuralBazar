# NeuralBazaar Migration Guide

This guide describes the safe order for the enterprise hardening work. It intentionally keeps the existing HTTP routes and current Sepolia/local contract addresses usable while new controls are introduced.

## Stage 1: configuration and database safety

1. Add a migration table and an advisory-lock migration runner.
2. Add nullable columns for upload SHA-256, scan status, quarantine reason, and model version.
3. Add indexes for status/category/created time, active listings, on-chain IDs, purchase ownership, and report status.
4. Backfill existing rows as `legacy_unverified`; do not silently mark existing public files as secure.
5. Make production startup fail when required secrets, contract addresses, chain ID, or admin wallet are missing.

## Stage 2: upload pipeline

1. Change the upload route from memory storage to disk/object-storage staging.
2. Stream the SHA-256 digest while writing the staged file.
3. Scan before encryption/pinning. The current implementation rejects unsafe PyTorch pickle files, executable signatures, shell patterns, archive traversal markers, and ClamAV detections.
4. Configure ClamAV in production; the heuristic scanner is a defense-in-depth layer, not a malware guarantee.
5. Encrypt each approved file with a random data key, wrap that key with `MODEL_ENCRYPTION_KEY`, and persist the ciphertext CID/digest/scanner version in `upload_manifests`.

## Stage 3: paid access

1. Stop returning public gateway URLs from access endpoints.
2. Encrypt model archives with a per-model data key or move them to a private object store.
3. After `hasAccess` succeeds, `/api/models/:id/access` fetches ciphertext server-side and decrypts it into a private streaming response.
4. Keep public previews and model cards separate from private model bytes.

## Stage 4: session and authorization hardening

1. The current implementation uses a `sessions` table containing a hashed token, wallet, user agent, timestamps, and revocation time.
2. Logout and `DELETE /api/auth/sessions/:id` revoke sessions server-side; the existing cookie name and auth endpoints remain compatible.
3. Verify on-chain model owner/creator before metadata persistence.
4. Add verified-purchase rating rules and moderation audit events.

Existing stateless JWTs do not contain a session ID and are intentionally rejected after this migration; users must sign in once again. This prevents pre-migration tokens from bypassing the revocation table.

## Stage 5: contract V2

1. Freeze the existing contracts for historical reads; do not alter their source or addresses after release.
2. V2 now provides multisig-admin roles, listing-transfer invariants, pull payments, and a separated access-grant role. Add a timelock policy at the Safe/governance layer before mainnet.
3. Deploy V2 to Sepolia and index from its deployment block into a new staging projection.
4. Provide a migration record mapping legacy model IDs/listings to V2 IDs where migration is legally and technically appropriate.
5. Switch frontend/backend configuration only after the complete staging flow passes.

## Backward compatibility rules

- Existing read endpoints remain available while new fields are nullable.
- Existing event rows remain immutable; new indexer versions use transaction hash/log index for identity.
- Existing public demo data is labeled legacy/unverified rather than retroactively claiming a scan or signature.
- Contract migration is additive. The old deployment remains queryable for historical purchases.
