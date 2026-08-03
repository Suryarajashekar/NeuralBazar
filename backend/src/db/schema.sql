CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'creator', 'moderator', 'admin')),
  account_type TEXT NOT NULL DEFAULT 'customer' CHECK (account_type IN ('customer', 'developer')),
  username TEXT UNIQUE,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'customer';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_type_check;
ALTER TABLE users ADD CONSTRAINT users_account_type_check CHECK (account_type IN ('customer', 'developer'));

CREATE TABLE IF NOT EXISTS sessions (
  session_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS auth_nonces (
  wallet_address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id_onchain BIGINT UNIQUE,
  creator_wallet TEXT NOT NULL REFERENCES users(wallet_address),
  ipfs_hash TEXT NOT NULL,
  metadata_uri TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  license TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'flagged', 'suspended', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_manifests (
  upload_id UUID PRIMARY KEY,
  owner_wallet TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  ipfs_hash TEXT UNIQUE NOT NULL,
  sha256 TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  scan_status TEXT NOT NULL CHECK (scan_status IN ('passed', 'rejected')),
  scanner_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'attached', 'expired', 'revoked')),
  model_id_onchain BIGINT UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  attached_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id_onchain BIGINT UNIQUE NOT NULL,
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  model_id_onchain BIGINT NOT NULL,
  seller_wallet TEXT NOT NULL,
  price_wei NUMERIC(78, 0) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_wallet TEXT NOT NULL,
  model_id UUID REFERENCES models(id) ON DELETE SET NULL,
  model_id_onchain BIGINT NOT NULL,
  listing_id_onchain BIGINT NOT NULL,
  price_paid_wei NUMERIC(78, 0) NOT NULL,
  tx_hash TEXT UNIQUE NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  reporter_wallet TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rater_wallet TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('model', 'developer')),
  target_key TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  review TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rater_wallet, target_type, target_key)
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS models_category_idx ON models(category);
CREATE INDEX IF NOT EXISTS models_creator_idx ON models(creator_wallet);
CREATE INDEX IF NOT EXISTS listings_active_idx ON listings(active);
CREATE INDEX IF NOT EXISTS purchases_buyer_idx ON purchases(buyer_wallet);
CREATE INDEX IF NOT EXISTS ratings_target_idx ON ratings(target_type, target_key);
CREATE INDEX IF NOT EXISTS upload_manifests_owner_idx ON upload_manifests(owner_wallet, status, created_at DESC);
CREATE INDEX IF NOT EXISTS upload_manifests_model_idx ON upload_manifests(model_id_onchain);

INSERT INTO indexer_state (id, last_block) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
