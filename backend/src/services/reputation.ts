import { query } from "../db";

export async function refreshCreatorReputation(walletAddress: string) {
  const user = await query<{ id: string }>("SELECT id FROM users WHERE lower(wallet_address) = lower($1)", [walletAddress]);
  if (!user.rows[0]) return null;
  const stats = await query<{
    average_rating: string;
    successful_sales: string;
    successful_downloads: string;
    fraud_reports: string;
  }>(
    `SELECT
       COALESCE((SELECT AVG(score)::numeric FROM ratings WHERE target_type = 'developer' AND lower(target_key) = lower($1)), 0)::numeric AS average_rating,
       COALESCE((SELECT COUNT(*) FROM purchases p JOIN models m ON m.model_id_onchain = p.model_id_onchain WHERE lower(m.creator_wallet) = lower($1)), 0)::text AS successful_sales,
       COALESCE((SELECT COUNT(*) FROM user_activity a JOIN models m ON m.id = a.model_id WHERE lower(m.creator_wallet) = lower($1) AND a.activity_type = 'downloaded'), 0)::text AS successful_downloads,
       COALESCE((SELECT COUNT(*) FROM reports r JOIN models m ON m.id = r.model_id WHERE lower(m.creator_wallet) = lower($1) AND r.status <> 'dismissed'), 0)::text AS fraud_reports`,
    [walletAddress]
  );
  const row = stats.rows[0];
  const averageRating = Number(row?.average_rating ?? 0);
  const sales = Number(row?.successful_sales ?? 0);
  const downloads = Number(row?.successful_downloads ?? 0);
  const fraudReports = Number(row?.fraud_reports ?? 0);
  const ratingComponent = (averageRating / 5) * 60;
  const activityComponent = Math.min(30, Math.log10(1 + sales + downloads) * 15);
  const penalty = Math.min(30, fraudReports * 5);
  const reputationScore = Math.max(0, Math.min(100, ratingComponent + activityComponent - penalty));
  const trustScore = Math.max(0, Math.min(100, reputationScore + (fraudReports === 0 ? 10 : -penalty)));
  const verified = sales > 0 && fraudReports === 0 && averageRating >= 3.5;
  const result = await query(
    `INSERT INTO creator_reputation (user_id, reputation_score, trust_score, successful_sales, successful_downloads, average_rating, fraud_reports, verified, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (user_id) DO UPDATE SET reputation_score = EXCLUDED.reputation_score, trust_score = EXCLUDED.trust_score,
       successful_sales = EXCLUDED.successful_sales, successful_downloads = EXCLUDED.successful_downloads,
       average_rating = EXCLUDED.average_rating, fraud_reports = EXCLUDED.fraud_reports, verified = EXCLUDED.verified, updated_at = now()
     RETURNING *`,
    [user.rows[0].id, reputationScore, trustScore, sales, downloads, averageRating, fraudReports, verified]
  );
  return result.rows[0];
}

