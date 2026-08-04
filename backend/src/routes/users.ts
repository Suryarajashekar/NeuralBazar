import { Router } from "express";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { requireAuth } from "../middleware/auth";
import { requirePermission } from "../services/identity";
import { canonicalRole, isCreator, isStaff } from "../services/identity";
import { normalizeUsername, usernameChangeAllowed } from "../services/username";

const router = Router();
const usernameParam = z.object({ username: z.string().min(1).max(60) });
const avatarSchema = z.string().max(4_000_000).refine(value => /^data:image\/(png|jpe?g|webp|gif);base64,/.test(value) || z.string().url().safeParse(value).success, "Avatar must be an image URL or a PNG, JPEG, WebP, or GIF image");
const profileSchema = z.object({
  username: z.string().optional(),
  displayName: z.string().trim().max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: avatarSchema.optional(),
  bannerUrl: z.string().url().max(2048).optional(),
  ensName: z.string().trim().max(255).optional(),
  website: z.string().url().max(2048).optional(),
  githubUrl: z.string().url().max(2048).optional(),
  linkedinUrl: z.string().url().max(2048).optional(),
  twitterUrl: z.string().url().max(2048).optional(),
  huggingfaceUrl: z.string().url().max(2048).optional(),
  portfolioUrl: z.string().url().max(2048).optional(),
  skills: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  organization: z.string().trim().max(160).optional(),
  location: z.string().trim().max(120).optional(),
  favoriteCategories: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  profileVisibility: z.object({ profile: z.boolean().optional(), wallet: z.boolean().optional() }).optional()
});

type UserRow = { id: string; wallet_address: string; role: string; username: string; display_name: string; bio: string; avatar_url: string | null; banner_url: string | null; ens_name: string | null; website: string | null; github_url: string | null; linkedin_url: string | null; twitter_url: string | null; huggingface_url: string | null; portfolio_url: string | null; skills: string[]; organization: string | null; location: string | null; favorite_categories: string[]; profile_visibility: { profile?: boolean; wallet?: boolean }; badges: string[]; verified: boolean; account_status: string; created_at: Date; last_active_at: Date | null };

async function findUser(username: string) {
  const normalized = username.toLowerCase();
  const current = await query<UserRow>("SELECT id, wallet_address, role, username, display_name, bio, avatar_url, banner_url, ens_name, website, github_url, linkedin_url, twitter_url, huggingface_url, portfolio_url, skills, organization, location, favorite_categories, profile_visibility, badges, verified, account_status, created_at, last_active_at FROM users WHERE lower(username) = $1", [normalized]);
  if (current.rows[0]) return { user: current.rows[0] };
  const history = await query<{ username: string }>("SELECT u.username FROM username_history h JOIN users u ON u.id = h.user_id WHERE lower(h.old_username) = $1 ORDER BY h.changed_at DESC LIMIT 1", [normalized]);
  return history.rows[0] ? { redirectUsername: history.rows[0].username } : {};
}

async function publicProfile(user: UserRow, req: import("express").Request) {
  const ownProfile = req.user?.sub === user.id;
  const staffProfile = Boolean(req.user && isStaff(req.user.role));
  const visibility = user.profile_visibility ?? {};
  if (visibility.profile === false && !ownProfile && !staffProfile) return null;
  const [followers, following, models, purchases, reputation, portfolio, downloads] = await Promise.all([
    query<{ count: string }>("SELECT count(*)::text AS count FROM creator_follows WHERE creator_user_id = $1", [user.id]),
    query<{ count: string }>("SELECT count(*)::text AS count FROM creator_follows WHERE follower_user_id = $1", [user.id]),
    query<{ count: string }>("SELECT count(*)::text AS count FROM models WHERE lower(creator_wallet) = lower($1) AND status <> 'removed'", [user.wallet_address]),
    query<{ count: string }>("SELECT count(*)::text AS count FROM purchases WHERE lower(buyer_wallet) = lower($1)", [user.wallet_address]),
    query("SELECT reputation_score, trust_score, successful_sales, successful_downloads, average_rating, verified FROM creator_reputation WHERE user_id = $1", [user.id])
    ,query(`SELECT m.id::text, m.model_id_onchain, m.title, m.description, m.category, m.tags, m.license, m.download_count,
                   COALESCE(ROUND(AVG(CASE WHEN r.target_type = 'model' THEN r.score END)::numeric, 1), 0) AS rating
            FROM models m LEFT JOIN ratings r ON r.target_type = 'model' AND r.target_key = m.id::text
            WHERE lower(m.creator_wallet) = lower($1) AND m.status = 'published'
            GROUP BY m.id ORDER BY m.created_at DESC LIMIT 6`, [user.wallet_address])
    ,query<{ count: string }>("SELECT COALESCE(SUM(download_count), 0)::text AS count FROM models WHERE lower(creator_wallet) = lower($1) AND status = 'published'", [user.wallet_address])
  ]);
  const creator = isCreator(user.role);
  const portfolioRating = portfolio.rows.length ? portfolio.rows.reduce((total, item) => total + Number(item.rating || 0), 0) / portfolio.rows.length : 0;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    bio: user.bio,
    avatarUrl: user.avatar_url,
    bannerUrl: user.banner_url,
    ensName: user.ens_name,
    website: creator ? user.website : null,
    githubUrl: creator ? user.github_url : null,
    linkedinUrl: creator ? user.linkedin_url : null,
    twitterUrl: creator ? user.twitter_url : null,
    huggingfaceUrl: creator ? user.huggingface_url : null,
    portfolioUrl: creator ? user.portfolio_url : null,
    skills: creator ? user.skills ?? [] : [],
    organization: user.organization,
    location: user.location,
    favoriteCategories: user.favorite_categories ?? [],
    role: canonicalRole(user.role),
    verified: user.verified || Boolean(reputation.rows[0]?.verified),
    badges: user.badges ?? [],
    walletAddress: ownProfile || staffProfile || visibility.wallet === true ? user.wallet_address : null,
    createdAt: user.created_at,
    lastActiveAt: user.last_active_at,
    stats: {
      followers: Number(followers.rows[0]?.count ?? 0),
      following: Number(following.rows[0]?.count ?? 0),
      models: Number(models.rows[0]?.count ?? 0),
      purchases: Number(purchases.rows[0]?.count ?? 0),
      sales: creator ? Number(reputation.rows[0]?.successful_sales ?? 0) : 0,
      downloads: creator ? Math.max(Number(reputation.rows[0]?.successful_downloads ?? 0), Number(downloads.rows[0]?.count ?? 0)) : 0,
      averageRating: creator ? Number(reputation.rows[0]?.average_rating ?? portfolioRating) : 0,
      reputationScore: creator ? Number(reputation.rows[0]?.reputation_score ?? 0) : 0,
      trustScore: creator ? Number(reputation.rows[0]?.trust_score ?? 0) : 0
    },
    portfolio: creator ? portfolio.rows : []
  };
}

async function getProfile(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  try {
    const { username } = usernameParam.parse(req.params);
    const result = await findUser(username);
    if (result.redirectUsername) return res.status(301).json({ redirect: true, redirectUsername: result.redirectUsername, url: `/profile/${result.redirectUsername}` });
    if (!result.user || result.user.account_status !== "active") return res.status(404).json({ error: "Profile not found" });
    const profile = await publicProfile(result.user, req);
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json({ profile });
  } catch (error) { next(error); }
}

router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim().slice(0, 100);
    if (q.length < 2) return res.json({ users: [] });
    const result = await query("SELECT username, display_name AS \"displayName\", avatar_url AS \"avatarUrl\", role, verified, organization FROM users WHERE account_status = 'active' AND (username ILIKE $1 OR display_name ILIKE $1 OR wallet_address ILIKE $1 OR organization ILIKE $1) ORDER BY verified DESC, username ASC LIMIT 25", [`%${q}%`]);
    res.json({ users: result.rows.map(row => ({ ...row, role: canonicalRole(row.role as string) })) });
  } catch (error) { next(error); }
});

router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const result = await query<UserRow>("SELECT id, wallet_address, role, username, display_name, bio, avatar_url, banner_url, ens_name, website, github_url, linkedin_url, twitter_url, huggingface_url, portfolio_url, skills, organization, location, favorite_categories, profile_visibility, badges, verified, account_status, created_at, last_active_at FROM users WHERE id = $1", [req.user!.sub]);
    if (!result.rows[0]) return res.status(404).json({ error: "Profile not found" });
    const profile = await publicProfile(result.rows[0], req);
    res.json({ profile });
  } catch (error) { next(error); }
});

router.patch("/profile", requireAuth, async (req, res, next) => {
  try {
    const body = profileSchema.parse(req.body);
    const profile = await withTransaction(async client => {
      const current = await client.query<{ id: string; username: string | null; username_changed_at: Date | null }>("SELECT id, username, username_changed_at FROM users WHERE id = $1 FOR UPDATE", [req.user!.sub]);
      if (!current.rows[0]) return null;
      const nextUsername = body.username === undefined ? current.rows[0].username : normalizeUsername(body.username);
      if (nextUsername !== current.rows[0].username) {
        if (!usernameChangeAllowed(current.rows[0].username_changed_at)) {
          const error = new Error("Username changes are limited to once every 30 days");
          (error as Error & { statusCode: number }).statusCode = 409;
          throw error;
        }
        const conflict = await client.query("SELECT 1 FROM users WHERE lower(username) = lower($1) AND id <> $2 UNION ALL SELECT 1 FROM username_history WHERE lower(old_username) = lower($1) LIMIT 1", [nextUsername, req.user!.sub]);
        if (conflict.rows[0]) {
          const error = new Error("Username is already taken");
          (error as Error & { statusCode: number }).statusCode = 409;
          throw error;
        }
        if (current.rows[0].username) await client.query("INSERT INTO username_history (user_id, old_username, new_username) VALUES ($1, $2, $3)", [req.user!.sub, current.rows[0].username, nextUsername]);
      }
      const updated = await client.query<UserRow>(
        `UPDATE users SET username = $2,
          username_changed_at = CASE WHEN $2 IS DISTINCT FROM username THEN now() ELSE username_changed_at END,
          display_name = COALESCE($3, display_name), bio = COALESCE($4, bio), avatar_url = COALESCE($5, avatar_url), banner_url = COALESCE($6, banner_url),
          ens_name = COALESCE($7, ens_name), website = COALESCE($8, website), github_url = COALESCE($9, github_url), linkedin_url = COALESCE($10, linkedin_url), twitter_url = COALESCE($11, twitter_url), huggingface_url = COALESCE($12, huggingface_url), portfolio_url = COALESCE($13, portfolio_url), skills = COALESCE($14::text[], skills),
          organization = COALESCE($15, organization), location = COALESCE($16, location), favorite_categories = COALESCE($17::text[], favorite_categories), profile_visibility = COALESCE($18::jsonb, profile_visibility), updated_at = now()
         WHERE id = $1
         RETURNING id, wallet_address, role, username, display_name, bio, avatar_url, banner_url, ens_name, website, github_url, linkedin_url, twitter_url, huggingface_url, portfolio_url, skills, organization, location, favorite_categories, profile_visibility, badges, verified, account_status, created_at, last_active_at`,
        [req.user!.sub, nextUsername, body.displayName, body.bio, body.avatarUrl, body.bannerUrl, body.ensName, body.website, body.githubUrl, body.linkedinUrl, body.twitterUrl, body.huggingfaceUrl, body.portfolioUrl, body.skills, body.organization, body.location, body.favoriteCategories, body.profileVisibility]
      );
      return updated.rows[0];
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    res.json({ profile: await publicProfile(profile, req) });
  } catch (error) { next(error); }
});

router.get("/:username/followers", async (req, res, next) => listConnections(req, res, next, "creator_user_id"));
router.get("/:username/following", async (req, res, next) => listConnections(req, res, next, "follower_user_id"));

async function listConnections(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction, column: "creator_user_id" | "follower_user_id") {
  try {
    const { username } = usernameParam.parse(req.params);
    const owner = await findUser(username);
    if (owner.redirectUsername) return res.status(301).json({ redirect: true, redirectUsername: owner.redirectUsername, url: `/profile/${owner.redirectUsername}` });
    if (!owner.user) return res.status(404).json({ error: "Profile not found" });
    const result = await query(`SELECT u.username, u.display_name AS \"displayName\", u.avatar_url AS \"avatarUrl\", u.role, u.verified FROM creator_follows f JOIN users u ON u.id = f.${column === "creator_user_id" ? "follower_user_id" : "creator_user_id"} WHERE f.${column} = $1 AND u.account_status = 'active' ORDER BY f.created_at DESC LIMIT 100`, [owner.user.id]);
    res.json({ users: result.rows.map(row => ({ ...row, role: canonicalRole(row.role as string) })) });
  } catch (error) { next(error); }
}

router.post("/:username/follow", requireAuth, requirePermission("marketplace.follow"), async (req, res, next) => followUser(req, res, next, true));
router.delete("/:username/follow", requireAuth, requirePermission("marketplace.follow"), async (req, res, next) => followUser(req, res, next, false));

async function followUser(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction, follow: boolean) {
  try {
    const { username } = usernameParam.parse(req.params);
    const target = await findUser(username);
    if (target.redirectUsername) return res.status(301).json({ redirect: true, redirectUsername: target.redirectUsername, url: `/profile/${target.redirectUsername}` });
    if (!target.user || !isCreator(target.user.role)) return res.status(404).json({ error: "Creator profile not found" });
    if (target.user.id === req.user!.sub) return res.status(400).json({ error: "You cannot follow yourself" });
    if (follow) await query("INSERT INTO creator_follows (follower_user_id, creator_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.user!.sub, target.user.id]);
    else await query("DELETE FROM creator_follows WHERE follower_user_id = $1 AND creator_user_id = $2", [req.user!.sub, target.user.id]);
    res.json({ following: follow });
  } catch (error) { next(error); }
}

router.get("/:username", getProfile);

export default router;
