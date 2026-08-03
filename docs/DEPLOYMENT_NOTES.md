# NeuralBazaar Deployment Notes

## Environments

Maintain separate credentials, databases, Pinata gateways, and contract deployments for local demo, Sepolia staging, and mainnet production. Never reuse the deployer private key as the backend signer unless the separation risk has been explicitly accepted for a disposable demo.

## Required production controls

1. Use a multisig for contract administration and treasury custody.
2. Put the API behind HTTPS, a reverse proxy/WAF, and a deployment-specific `trust proxy` configuration.
3. Store secrets in Vercel/Render secret storage, not in repository files or build logs.
4. Use a managed PostgreSQL instance with TLS, backups, point-in-time recovery, and restricted network access.
5. Use a private gateway or encrypted object storage for paid model bytes. A public IPFS CID is not an access-control mechanism.
6. Set `MODEL_ENCRYPTION_KEY` to a base64-encoded 32-byte secret and configure `CLAMAV_PATH`; production startup rejects missing values.
7. Run database migrations as a release job, not on every horizontally scaled web restart.
8. Run `npm start` for the API and `npm run start:worker` as one separately scaled worker instance with health checks, durable progress, retries, and alerts.
9. Deploy V2 with `GOVERNANCE_MULTISIG` and a dedicated `BACKEND_GRANTER_ADDRESS`; do not give the backend the multisig key.
10. Verify contract bytecode and record deployed addresses, compiler version, chain ID, and deployment block in an immutable release record.

## Release sequence

1. Run dependency installation from the lockfile.
2. Compile and test contracts, including invariant/fuzz tests for the chosen release.
3. Build and lint backend and frontend.
4. Apply database migrations to an empty staging database, then run a rehearsal against a sanitized production snapshot.
5. Deploy V2 contracts to Sepolia and run register/list/buy/access/withdraw/moderation tests.
6. Deploy API and the separate indexer worker, confirm health and indexer lag metrics.
7. Deploy frontend with the matching chain and contract addresses.
8. Perform a wallet-switch, unauthorized-route, upload-rejection, purchase, and access-delivery smoke test.
9. Only then enable creator publishing for the intended audience.

## Rollback

- Frontend: roll back to the previous immutable build.
- API: roll back application code only if its database schema remains backward compatible.
- Database: use a forward-fix migration; do not reset production data.
- Contracts: pause the marketplace through multisig if required, preserve event history, and route to the documented V2 migration path. Deployed non-upgradeable contracts cannot be patched in place.
