# NeuralBazaar — Decentralized AI Marketplace

NeuralBazaar is a production-oriented monorepo for publishing, licensing, rating, and purchasing AI models with wallet authentication, IPFS storage, PostgreSQL indexing, and Solidity contracts on Sepolia.

## Repository structure

```text
contracts/   Solidity contracts, Hardhat config, tests, Sepolia deploy script
frontend/    Next.js App Router + TypeScript + Tailwind user application
backend/     Express API, PostgreSQL schema, Pinata uploads, event indexer
docs/        Architecture and deployment runbook
```

This repository is deploy-ready, but a real public deployment necessarily needs your own RPC provider, wallet keys, Pinata account, PostgreSQL database, hosting accounts, and domain. Never commit any secret or fund a production deployer wallet with more than it needs.

## Quick start

1. Copy `.env.example` to the appropriate `.env` files described in `docs/README.md`.
2. Start PostgreSQL with `docker compose up -d postgres`.
3. Run `npm install` from the repository root.
4. Run `npm run compile:contracts` and deploy to Sepolia.
5. Put the deployed addresses into the backend and frontend environment files.
6. Run `npm run dev`.

## Important production decisions

- Model binaries are stored on IPFS; the blockchain stores ownership, licensing, and payment state.
- A successful `ModelPurchased` event is indexed by the backend, which grants access through `AccessManager`.
- Set `ADMIN_WALLET_ADDRESS` to the approved administrator wallet in production. If it is blank, local setup uses first-admin bootstrap; subsequent role changes are admin-only API operations.
- Sessions use an HttpOnly cookie, and `/api/admin/*` re-checks the current role in PostgreSQL on every request.
- Ratings are stored off-chain with one rating per wallet per target. The model page shows model ratings and creator ratings separately.
- Set `PLATFORM_FEE_BPS` on the marketplace only after treasury and accounting policies are reviewed.

See [`docs/README.md`](docs/README.md) for setup, security, Sepolia deployment, Vercel/Render deployment, domain configuration, and mainnet migration.
