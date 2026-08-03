# NeuralBazaar deployment runbook

## 1. Architecture

```text
Wallet (MetaMask / WalletConnect)
        │ SIWE signature + wagmi contract calls
        ▼
Next.js frontend on Vercel ───────► Express API on Render
        │                                  │
        │ IPFS gateway                     ├── PostgreSQL / Supabase
        ▼                                  ├── Pinata uploads
Model binary + metadata on IPFS            └── Sepolia event indexer

AIModelRegistry ◄──► AIModelMarketplace ──► AccessManager
      ERC-721             ETH + royalties       token-gated access
```

The chain is the source of truth for model identity, ownership, listings, payment, and purchase events. PostgreSQL is a query index and profile/rating store. IPFS stores model payloads and metadata. The indexer is intentionally idempotent: it can replay events into PostgreSQL without duplicating purchases.

## 2. Local setup

### Prerequisites

- Node.js 20+
- Docker Desktop, or a hosted PostgreSQL provider such as Supabase
- MetaMask with Sepolia ETH
- Pinata account and JWT
- RPC provider such as Infura or Alchemy

```powershell
cd C:\path\to\decentralized-ai-marketplace
npm install
```

Docker is optional. If you use Supabase, set `DATABASE_URL` to the Supabase PostgreSQL connection string and set `DATABASE_SSL=true` in `backend/.env`. If you install PostgreSQL locally, use `DATABASE_SSL=false` and create the `ai_marketplace` database yourself.

Create separate env files from the examples:

- `contracts/.env` for Hardhat deployment
- `backend/.env` for the API and indexer
- `frontend/.env.local` for the browser app

The root values are a reference. The app processes read the environment file in their own package directory when deployed independently.

## 3. Deploy contracts to Sepolia

Use a dedicated deployer wallet. Fund it with only enough Sepolia ETH for deployment and test transactions.

```powershell
cd contracts
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.ts --network sepolia
```

The script writes `contracts/deployments/sepolia.json`. Copy the three addresses into `backend/.env` and `frontend/.env.local`:

```text
REGISTRY_ADDRESS=0x...
MARKETPLACE_ADDRESS=0x...
ACCESS_MANAGER_ADDRESS=0x...
NEXT_PUBLIC_CONTRACT_ADDRESS_REGISTRY=0x...
NEXT_PUBLIC_CONTRACT_ADDRESS_MARKETPLACE=0x...
NEXT_PUBLIC_CONTRACT_ADDRESS_ACCESS=0x...
```

The wallet used by the backend indexer must own `AccessManager`. If it is a different signer, transfer ownership from the deployer after deployment using an admin script or a multisig policy. Do not put the backend signer private key in the frontend environment.

Verify contracts after Etherscan has indexed them:

```powershell
npx hardhat run scripts/verify.ts --network sepolia
```

## 4. Start the backend

```powershell
cd backend
npm install
npm run db:migrate
npm run seed
npm run dev
```

Set `ADMIN_WALLET_ADDRESS` in `backend/.env` to the exact lowercase wallet that should control the platform. That wallet is promoted to `admin` when it signs in; all other new wallets default to `buyer`. For a local classroom demo, leaving it blank preserves the first-admin bootstrap behavior, but do not leave it blank in production because an unknown first visitor could claim the initial admin role. The `/admin/login` page and every `/api/admin/*` endpoint require the current database role to be `admin`.

The indexer polls every 15 seconds and:

1. Syncs `ModelRegistered`, `ListingCreated`, `ListingCancelled`, `ListingPriceUpdated`, and `ModelPurchased`.
2. Upserts searchable model/listing records.
3. Writes purchases with the transaction hash as the idempotency key.
4. Calls `AccessManager.grantAccess(buyer, modelId)` after a purchase.

## 5. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The browser must have MetaMask or a WalletConnect-compatible wallet configured for Sepolia. The login flow obtains a server nonce, signs a SIWE-compatible message, and receives an HttpOnly session cookie. Contract actions remain direct wallet transactions.

### Creator flow

1. Sign in and have an admin assign the `creator` role.
2. Upload the model archive to `/api/uploads/model`.
3. Upload JSON metadata to `/api/uploads/metadata`.
4. Sign `registerModel`.
5. Sign ERC-721 `approve` for the marketplace.
6. Sign `createListing`.
7. Save the searchable record in PostgreSQL.

### Buyer flow

1. Browse the indexed marketplace.
2. Open a model detail page and review license, creator rating, and model rating.
3. Sign `buyModel` with the exact listing price.
4. Wait for the indexer to grant `AccessManager` access.

Model downloads and inference should be served from a future token-gated API route that checks `hasAccess` before issuing a short-lived signed URL. Do not expose raw Pinata gateway URLs for private model archives.

## 6. Deploy to Render and Vercel

### Backend on Render

1. Create a Render Web Service from the repository.
2. Set the root directory to `backend`.
3. Build command: `npm install && npm run build && npm run db:migrate`.
4. Start command: `npm start`.
5. Add all variables from `backend/.env.example`.
6. Use a Render PostgreSQL database or Supabase and set `DATABASE_URL` to its connection string.
7. Add a health check path of `/health`.

For production, run migrations as a release step instead of on every web process restart. If you scale the API horizontally, run the indexer as a separate single-instance worker so two indexers do not race on access grants.

### Frontend on Vercel

1. Import the repository into Vercel.
2. Set the root directory to `frontend`.
3. Add values from `frontend/.env.local.example` using the Render API URL and deployed Sepolia addresses.
4. Build command: `npm run build`.
5. Deploy and test wallet connection from the Vercel URL.

### Custom domain and HTTPS

In Vercel, open the project’s Settings → Domains, add the domain, then create the DNS record Vercel gives you at your registrar. Vercel provisions HTTPS automatically after DNS validation. Update `FRONTEND_URL` on Render to the final HTTPS origin and redeploy the API.

## 7. Run a complete local demo without Sepolia ETH

For a classroom or major-project presentation, you can run the contracts on a local Hardhat blockchain. This uses pre-funded local accounts and does not require a faucet, mainnet ETH, or public deployment.

Terminal 1:

```powershell
cd contracts
npx.cmd hardhat node
```

Hardhat prints local accounts and private keys. Use Account #0 for deployment/backend access and import Account #0 and Account #1 into MetaMask as separate local demo wallets.

Terminal 2:

```powershell
cd contracts
npx.cmd hardhat run scripts/deploy.ts --network localhost
```

This creates `contracts/deployments/localhost.json`. Put those addresses into `backend/.env` and `frontend/.env.local`, then set:

```env
# backend/.env
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
BACKEND_SIGNER_PRIVATE_KEY=<Hardhat Account #0 private key>

# frontend/.env.local
NEXT_PUBLIC_NETWORK=local
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
```

For local deployment, leave `PLATFORM_TREASURY` blank in `contracts/.env` so it defaults to the local deployer account. Restart the backend and frontend after changing environment files. In MetaMask, add a custom network with RPC `http://127.0.0.1:8545`, chain ID `31337`, and currency `ETH`.

## 8. Security checklist

- Never commit `.env`, private keys, JWT secrets, Pinata JWTs, or database passwords.
- Keep the API session in the HttpOnly cookie; do not move it back to browser `localStorage`.
- Set `ADMIN_WALLET_ADDRESS` in production and use `/admin/login`; frontend checks are for navigation only, while Express + PostgreSQL enforce authorization.
- Use a multisig for marketplace ownership before mainnet.
- Keep `platformFeeBps` at zero until accounting and legal policies are reviewed.
- Limit model archive size and MIME types at the upload edge; use an object storage staging bucket for files larger than the configured memory upload limit.
- Add malware scanning, model-card moderation, and abuse reporting before accepting arbitrary uploads.
- Use a private Pinata gateway and signed URLs for paid assets.
- Monitor indexer lag, failed access grants, contract pause status, and database errors.
- Add Sentry or equivalent error tracking to frontend, API, and worker processes.
- Audit contracts before mainnet. Sepolia testing is not a security audit.

## 9. Switching to mainnet

1. Choose a low-fee EVM chain such as Base, Polygon, or Arbitrum.
2. Update `CHAIN_ID`, `NETWORK_NAME`, RPC URLs, wagmi chain configuration, and explorer links.
3. Deploy fresh contracts; do not reuse Sepolia addresses.
4. Set treasury and fee policy through a multisig.
5. Re-index from the mainnet deployment block into a new production database.
6. Verify contracts, test buy/royalty/access flows with a small amount, then enable public publishing.

## 10. Required environment variables

### Contracts

`PRIVATE_KEY`, `RPC_URL`, `ETHERSCAN_API_KEY`, `PLATFORM_TREASURY`

### Backend

`PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `ADMIN_WALLET_ADDRESS`, `BACKEND_PUBLIC_URL`, `RPC_URL`, `CHAIN_ID`, `INDEXER_START_BLOCK`, `REGISTRY_ADDRESS`, `MARKETPLACE_ADDRESS`, `ACCESS_MANAGER_ADDRESS`, `BACKEND_SIGNER_PRIVATE_KEY`, `PINATA_JWT`, `PINATA_GATEWAY`

### Frontend

`NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_CONTRACT_ADDRESS_REGISTRY`, `NEXT_PUBLIC_CONTRACT_ADDRESS_MARKETPLACE`, `NEXT_PUBLIC_CONTRACT_ADDRESS_ACCESS`
