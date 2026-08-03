import { PoolClient } from "pg";
import { z } from "zod";

export const RESERVED_USERNAMES = new Set(["admin", "administrator", "api", "billing", "moderator", "owner", "root", "staff", "support", "system", "security", "superadmin"]);
export const USERNAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

export class UsernameValidationError extends Error {
  statusCode = 400;
  constructor(message: string) { super(message); this.name = "UsernameValidationError"; }
}

export const usernameSchema = z.string().trim().min(3).max(30).regex(USERNAME_PATTERN, "Username may contain letters, numbers, dots, underscores, and hyphens").transform(value => value.toLowerCase()).refine(value => !RESERVED_USERNAMES.has(value), "This username is reserved");

export function normalizeUsername(value: string) {
  const parsed = usernameSchema.safeParse(value);
  if (!parsed.success) throw new UsernameValidationError(parsed.error.issues[0]?.message ?? "Invalid username");
  return parsed.data;
}

export function fallbackUsername(walletAddress: string) {
  return `user_${walletAddress.replace(/^0x/i, "").slice(0, 10).toLowerCase()}`;
}

export function usernameChangeAllowed(lastChanged: Date | string | null | undefined, now = new Date()) {
  if (!lastChanged) return true;
  return now.getTime() - new Date(lastChanged).getTime() >= 30 * 24 * 60 * 60 * 1000;
}

export async function ensureUsername(client: Pick<PoolClient, "query">, userId: string, walletAddress: string) {
  const existing = await client.query<{ username: string | null }>("SELECT username FROM users WHERE id = $1", [userId]);
  if (existing.rows[0]?.username) return existing.rows[0].username;

  const base = fallbackUsername(walletAddress);
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base.slice(0, Math.max(3, 30 - String(suffix).length - 1))}_${suffix}`;
    const taken = await client.query("SELECT 1 FROM users WHERE lower(username) = lower($1) UNION ALL SELECT 1 FROM username_history WHERE lower(old_username) = lower($1) LIMIT 1", [candidate]);
    if (taken.rows[0]) continue;
    const updated = await client.query<{ username: string }>("UPDATE users SET username = $2, username_changed_at = now(), updated_at = now() WHERE id = $1 RETURNING username", [userId, candidate]);
    return updated.rows[0]?.username ?? candidate;
  }
  throw new UsernameValidationError("Unable to allocate a unique username");
}
