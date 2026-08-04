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
  refresh_token_hash TEXT,
  device_id TEXT NOT NULL DEFAULT '',
  idle_expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS refresh_token_hash TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS idle_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, revoked_at, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_token_idx ON sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_request_nonces (
  api_key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, nonce)
);

CREATE INDEX IF NOT EXISTS api_request_nonces_expiry_idx ON api_request_nonces(expires_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_sub TEXT NOT NULL DEFAULT '',
  actor_wallet TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  request_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_sub TEXT NOT NULL DEFAULT '',
  actor_wallet TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  request_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS authentication_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  wallet_address TEXT NOT NULL DEFAULT '',
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  failure_code TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_logs_created_idx ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS authentication_logs_user_idx ON authentication_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authentication_logs_wallet_idx ON authentication_logs(wallet_address, created_at DESC);

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

-- Enterprise model security, provenance, search, reputation, benchmarking,
-- versioning, collaboration, analytics, and research extensions. All fields
-- are additive so existing marketplace rows remain readable.
ALTER TABLE models ADD COLUMN IF NOT EXISTS security_score INTEGER CHECK (security_score BETWEEN 0 AND 100);
ALTER TABLE models ADD COLUMN IF NOT EXISTS security_status TEXT CHECK (security_status IN ('pending', 'verified_safe', 'rejected', 'legacy_unverified'));
ALTER TABLE models ADD COLUMN IF NOT EXISTS verified_safe BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS security_report JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE models ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE models ADD COLUMN IF NOT EXISTS search_document TSVECTOR;
ALTER TABLE models ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE models ADD COLUMN IF NOT EXISTS trending_score NUMERIC(14, 4) NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN IF NOT EXISTS download_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN IF NOT EXISTS screenshots TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN IF NOT EXISTS demo_video_url TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS playground_url TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS documentation_url TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS api_reference_url TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS supported_languages TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE models ADD COLUMN IF NOT EXISTS current_version TEXT NOT NULL DEFAULT 'v1.0.0';
ALTER TABLE models ADD COLUMN IF NOT EXISTS changelog JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE models ADD COLUMN IF NOT EXISTS context_length INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS gpu_requirement TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS content_hash TEXT;

ALTER TABLE models ALTER COLUMN security_status SET DEFAULT 'legacy_unverified';
UPDATE models SET security_status = 'legacy_unverified' WHERE security_status IS NULL AND status = 'published';

-- Existing published rows predate the verification gate. Keep them readable
-- for compatibility, but label them explicitly so clients do not mistake
-- them for newly verified uploads.
UPDATE models SET security_status = 'legacy_unverified'
WHERE security_status = 'pending' AND status = 'published' AND verified_safe = false;

ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS original_sha256 TEXT;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS encrypted_sha256 TEXT;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS security_score INTEGER CHECK (security_score BETWEEN 0 AND 100);
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS security_status TEXT CHECK (security_status IN ('verified_safe', 'rejected'));
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS verified_safe BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS security_report JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS signed_manifest JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS signature_public_key TEXT;
ALTER TABLE upload_manifests ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS verified_purchase BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS purchase_tx_hash TEXT;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS report_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS onchain_review_hash TEXT;
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS onchain_review_tx_hash TEXT;

-- Phase 9 blockchain provenance. These records are materialized from the
-- contract event stream while the contracts remain the source of truth.
CREATE TABLE IF NOT EXISTS license_tokens (
  license_id_onchain BIGINT PRIMARY KEY,
  model_id_onchain BIGINT NOT NULL,
  owner_wallet TEXT NOT NULL,
  creator_wallet TEXT NOT NULL,
  model_hash TEXT NOT NULL,
  license_uri TEXT NOT NULL,
  issued_tx_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS license_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id_onchain BIGINT NOT NULL,
  model_id_onchain BIGINT NOT NULL,
  buyer_wallet TEXT NOT NULL,
  seller_wallet TEXT NOT NULL,
  price_paid_wei NUMERIC(78, 0) NOT NULL,
  royalty_paid_wei NUMERIC(78, 0) NOT NULL DEFAULT 0,
  tx_hash TEXT NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id_onchain, tx_hash)
);

CREATE TABLE IF NOT EXISTS onchain_reviews (
  review_hash TEXT PRIMARY KEY,
  model_id_onchain BIGINT NOT NULL,
  reviewer_wallet TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  review_uri TEXT NOT NULL,
  tx_hash TEXT UNIQUE NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS license_tokens_owner_idx ON license_tokens(owner_wallet);
CREATE INDEX IF NOT EXISTS license_tokens_model_idx ON license_tokens(model_id_onchain);
CREATE INDEX IF NOT EXISTS license_purchases_buyer_idx ON license_purchases(buyer_wallet);
CREATE INDEX IF NOT EXISTS onchain_reviews_model_idx ON onchain_reviews(model_id_onchain);

CREATE TABLE IF NOT EXISTS creator_reputation (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reputation_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  trust_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
  successful_sales BIGINT NOT NULL DEFAULT 0,
  successful_downloads BIGINT NOT NULL DEFAULT 0,
  average_rating NUMERIC(4, 2) NOT NULL DEFAULT 0,
  fraud_reports BIGINT NOT NULL DEFAULT 0,
  verified BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version_id UUID,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'not_available', 'failed')),
  accuracy NUMERIC(10, 6),
  precision_score NUMERIC(10, 6),
  recall NUMERIC(10, 6),
  f1 NUMERIC(10, 6),
  latency_ms NUMERIC(14, 4),
  cpu_memory_mb NUMERIC(14, 4),
  gpu_memory_mb NUMERIC(14, 4),
  model_size_bytes BIGINT,
  inference_speed NUMERIC(14, 4),
  dataset_name TEXT NOT NULL DEFAULT '',
  runner_version TEXT NOT NULL DEFAULT '',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE benchmark_runs ADD COLUMN IF NOT EXISTS cost_per_1k_tokens NUMERIC(14, 6);

CREATE TABLE IF NOT EXISTS evaluation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset_name TEXT NOT NULL,
  dataset_size_bytes BIGINT NOT NULL DEFAULT 0,
  dataset_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'not_available', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id UUID NOT NULL REFERENCES evaluation_jobs(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  benchmark_run_id UUID REFERENCES benchmark_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'not_available', 'failed')),
  accuracy NUMERIC(10, 6),
  latency_ms NUMERIC(14, 4),
  memory_mb NUMERIC(14, 4),
  cost_per_1k_tokens NUMERIC(14, 6),
  leaderboard_score NUMERIC(14, 6),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (evaluation_id, model_id)
);

ALTER TABLE benchmark_runs ADD COLUMN IF NOT EXISTS evaluation_id UUID REFERENCES evaluation_jobs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS model_embeddings (
  model_id UUID PRIMARY KEY REFERENCES models(id) ON DELETE CASCADE,
  embedding JSONB NOT NULL,
  embedding_model TEXT NOT NULL,
  source_text_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('viewed', 'downloaded', 'searched', 'wishlist_added')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  upload_id UUID REFERENCES upload_manifests(upload_id) ON DELETE RESTRICT,
  file_sha256 TEXT NOT NULL,
  metadata_sha256 TEXT NOT NULL DEFAULT '',
  release_notes TEXT NOT NULL DEFAULT '',
  changelog JSONB NOT NULL DEFAULT '[]'::jsonb,
  onchain_version TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, version)
);

ALTER TABLE benchmark_runs ADD COLUMN IF NOT EXISTS version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS wishlists (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, model_id)
);

CREATE TABLE IF NOT EXISTS creator_follows (
  follower_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, creator_user_id),
  CHECK (follower_user_id <> creator_user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS featured_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type TEXT NOT NULL CHECK (item_type IN ('model', 'creator')),
  item_key TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'home',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  created_by TEXT NOT NULL DEFAULT '',
  UNIQUE (item_type, item_key, placement)
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  billing_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer', 'billing')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  external_reference TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  model_id UUID REFERENCES models(id) ON DELETE SET NULL,
  api_key_id TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms NUMERIC(14, 4) NOT NULL DEFAULT 0,
  units BIGINT NOT NULL DEFAULT 1,
  tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('federated_learning', 'zk_ownership', 'differential_privacy', 'explainability', 'carbon', 'lineage', 'reproducibility')),
  status TEXT NOT NULL DEFAULT 'pending',
  artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cross_chain_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES models(id) ON DELETE CASCADE,
  chain_id BIGINT NOT NULL,
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  transaction_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, chain_id)
);

CREATE TABLE IF NOT EXISTS dao_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  onchain_proposal_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compute_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  gpu_type TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  price_per_hour NUMERIC(18, 6) NOT NULL,
  available BOOLEAN NOT NULL DEFAULT true,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS models_security_idx ON models(verified_safe, security_score DESC, status);
CREATE INDEX IF NOT EXISTS models_trending_idx ON models(trending_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS models_search_document_idx ON models USING GIN(search_document);
CREATE INDEX IF NOT EXISTS benchmark_runs_model_idx ON benchmark_runs(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS benchmark_runs_cost_idx ON benchmark_runs(cost_per_1k_tokens);
CREATE INDEX IF NOT EXISTS evaluation_jobs_owner_idx ON evaluation_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evaluation_results_eval_idx ON evaluation_results(evaluation_id, leaderboard_score DESC);
CREATE INDEX IF NOT EXISTS model_embeddings_model_idx ON model_embeddings(model_id);
CREATE INDEX IF NOT EXISTS user_activity_recent_idx ON user_activity(user_id, activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS model_versions_model_idx ON model_versions(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_org_idx ON api_usage(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_user_idx ON api_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_artifacts_model_idx ON research_artifacts(model_id, artifact_type, created_at DESC);

ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS model_id UUID REFERENCES models(id) ON DELETE SET NULL;
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS tokens BIGINT NOT NULL DEFAULT 0;
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(14, 6) NOT NULL DEFAULT 0;
ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS api_usage_model_idx ON api_usage(model_id, created_at DESC);

CREATE OR REPLACE FUNCTION neuralbazaar_models_search_document() RETURNS trigger AS $$
BEGIN
  NEW.search_document := to_tsvector('simple', coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '') || ' ' || coalesce(NEW.category, '') || ' ' || array_to_string(coalesce(NEW.tags, '{}'), ' '));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'models_search_document_trigger') THEN
    CREATE TRIGGER models_search_document_trigger BEFORE INSERT OR UPDATE OF title, description, category, tags ON models
    FOR EACH ROW EXECUTE FUNCTION neuralbazaar_models_search_document();
  END IF;
END $$;

UPDATE models SET search_document = to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, '') || ' ' || array_to_string(coalesce(tags, '{}'), ' ')) WHERE search_document IS NULL;

-- Enterprise identity and role-management extensions. These statements are
-- additive and deliberately retain buyer/admin as legacy role aliases.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'creator', 'support_admin', 'moderator', 'super_admin', 'buyer', 'admin'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banner_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ens_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS github_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS huggingface_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS portfolio_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorite_categories TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_visibility JSONB NOT NULL DEFAULT '{"profile": true, "wallet": false}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_status_check;
ALTER TABLE users ADD CONSTRAINT users_account_status_check CHECK (account_status IN ('active', 'suspended', 'banned', 'deleted'));
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username)) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_status_idx ON users(role, account_status, created_at DESC);
CREATE INDEX IF NOT EXISTS users_identity_search_idx ON users USING GIN (to_tsvector('simple', coalesce(username, '') || ' ' || coalesce(display_name, '') || ' ' || coalesce(wallet_address, '') || ' ' || coalesce(organization, '')));

CREATE TABLE IF NOT EXISTS username_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_username TEXT NOT NULL,
  new_username TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS username_history_old_lower_unique ON username_history (lower(old_username));
CREATE INDEX IF NOT EXISTS username_history_user_idx ON username_history(user_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS creator_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_tickets_queue_idx ON support_tickets(status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_requester_idx ON support_tickets(requester_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'past_due')),
  monthly_credits BIGINT NOT NULL DEFAULT 0,
  credits_used BIGINT NOT NULL DEFAULT 0,
  monthly_cost_usd NUMERIC(14, 2) NOT NULL DEFAULT 0,
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id, status, renews_at DESC);

CREATE TABLE IF NOT EXISTS refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  reviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requester_user_id, purchase_id)
);
CREATE INDEX IF NOT EXISTS refund_requests_status_idx ON refund_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS model_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  moderation_notes TEXT NOT NULL DEFAULT '',
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_comments_moderation_idx ON model_comments(moderation_status, created_at DESC);

CREATE TABLE IF NOT EXISTS model_likes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, model_id)
);
CREATE INDEX IF NOT EXISTS model_likes_model_idx ON model_likes(model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'copy_link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_shares_model_idx ON model_shares(model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS model_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'discussion' CHECK (kind IN ('discussion', 'bug', 'feature', 'question')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS discussion_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id UUID NOT NULL REFERENCES model_discussions(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_discussions_model_idx ON model_discussions(model_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS discussion_comments_thread_idx ON discussion_comments(discussion_id, created_at ASC);

CREATE TABLE IF NOT EXISTS creator_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('draft', 'running', 'paused', 'completed')),
  primary_metric TEXT NOT NULL DEFAULT 'conversion_rate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS creator_experiment_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES creator_experiments(id) ON DELETE CASCADE,
  variant_key TEXT NOT NULL,
  label TEXT NOT NULL,
  version_id UUID REFERENCES model_versions(id) ON DELETE SET NULL,
  traffic_percent NUMERIC(5, 2) NOT NULL DEFAULT 50 CHECK (traffic_percent >= 0 AND traffic_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, variant_key)
);
CREATE TABLE IF NOT EXISTS creator_experiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES creator_experiments(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES creator_experiment_variants(id) ON DELETE CASCADE,
  visitor_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('view', 'purchase')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_experiment_events_idx ON creator_experiment_events(experiment_id, variant_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS faq_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  sort_order INTEGER NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  published BOOLEAN NOT NULL DEFAULT false,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_api_keys (
  id TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  secret_hash BYTEA NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer', 'creator', 'support_admin', 'moderator', 'super_admin', 'buyer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS managed_api_keys_owner_idx ON managed_api_keys(owner_user_id, revoked_at);

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'visible';
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS moderation_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_moderation_status_check;
ALTER TABLE ratings ADD CONSTRAINT ratings_moderation_status_check CHECK (moderation_status IN ('visible', 'hidden', 'warned'));

-- Audit and authentication records are append-only. Application roles should
-- not be able to erase the evidence of an administrative action.
CREATE OR REPLACE FUNCTION neuralbazaar_prevent_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Security logs are append-only';
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_logs_append_only') THEN
    CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION neuralbazaar_prevent_log_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'admin_logs_append_only') THEN
    CREATE TRIGGER admin_logs_append_only BEFORE UPDATE OR DELETE ON admin_logs FOR EACH ROW EXECUTE FUNCTION neuralbazaar_prevent_log_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'authentication_logs_append_only') THEN
    CREATE TRIGGER authentication_logs_append_only BEFORE UPDATE OR DELETE ON authentication_logs FOR EACH ROW EXECUTE FUNCTION neuralbazaar_prevent_log_mutation();
  END IF;
END $$;
