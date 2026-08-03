import { NextFunction, Request, Response } from "express";

/**
 * The canonical enterprise roles. buyer/admin remain accepted by the
 * compatibility layer so existing tokens, API keys, and database rows keep
 * working while new identities use customer/super_admin.
 */
export type EnterpriseRole = "customer" | "creator" | "support_admin" | "moderator" | "super_admin" | "buyer" | "admin";

export type Permission =
  | "marketplace.browse" | "marketplace.purchase" | "marketplace.download" | "marketplace.wishlist"
  | "marketplace.review" | "marketplace.follow"
  | "model.upload" | "model.manage" | "model.version" | "analytics.creator"
  | "support.profile.read" | "support.purchases.read" | "support.downloads.read"
  | "support.username.reset" | "support.notifications.send" | "support.tickets.manage"
  | "moderation.content" | "moderation.reports" | "moderation.users.suspend" | "moderation.creator.verify"
  | "admin.users.manage" | "admin.roles.manage" | "admin.settings.manage" | "admin.financial.read"
  | "admin.audit.read" | "admin.api_keys.manage" | "admin.announcements" | "admin.maintenance";

const rolePermissions: Record<"customer" | "creator" | "support_admin" | "moderator" | "super_admin", readonly Permission[]> = {
  customer: ["marketplace.browse", "marketplace.purchase", "marketplace.download", "marketplace.wishlist", "marketplace.review", "marketplace.follow"],
  creator: ["marketplace.browse", "marketplace.purchase", "marketplace.download", "marketplace.wishlist", "marketplace.review", "marketplace.follow", "model.upload", "model.manage", "model.version", "analytics.creator"],
  support_admin: ["marketplace.browse", "marketplace.purchase", "marketplace.download", "marketplace.wishlist", "marketplace.review", "marketplace.follow", "support.profile.read", "support.purchases.read", "support.downloads.read", "support.username.reset", "support.notifications.send", "support.tickets.manage"],
  moderator: ["marketplace.browse", "marketplace.purchase", "marketplace.download", "marketplace.wishlist", "marketplace.review", "marketplace.follow", "support.profile.read", "support.purchases.read", "support.downloads.read", "support.tickets.manage", "moderation.content", "moderation.reports", "moderation.users.suspend", "moderation.creator.verify"],
  super_admin: ["marketplace.browse", "marketplace.purchase", "marketplace.download", "marketplace.wishlist", "marketplace.review", "marketplace.follow", "model.upload", "model.manage", "model.version", "analytics.creator", "support.profile.read", "support.purchases.read", "support.downloads.read", "support.username.reset", "support.notifications.send", "support.tickets.manage", "moderation.content", "moderation.reports", "moderation.users.suspend", "moderation.creator.verify", "admin.users.manage", "admin.roles.manage", "admin.settings.manage", "admin.financial.read", "admin.audit.read", "admin.api_keys.manage", "admin.announcements", "admin.maintenance"]
};

export function canonicalRole(role: string): "customer" | "creator" | "support_admin" | "moderator" | "super_admin" {
  if (role === "buyer") return "customer";
  if (role === "admin") return "super_admin";
  if (role in rolePermissions) return role as keyof typeof rolePermissions;
  return "customer";
}

export function roleLabel(role: string) {
  return ({ customer: "Customer", buyer: "Customer", creator: "Creator", support_admin: "Support Admin", moderator: "Moderator", super_admin: "Super Admin", admin: "Super Admin" } as Record<string, string>)[role] ?? "Customer";
}

export function hasPermission(role: string, permission: Permission) {
  return canonicalRole(role) === "super_admin" || rolePermissions[canonicalRole(role)].includes(permission);
}

export function isSuperAdmin(role: string) { return canonicalRole(role) === "super_admin"; }
export function isCreator(role: string) { return canonicalRole(role) === "creator" || isSuperAdmin(role); }
export function isStaff(role: string) { return ["support_admin", "moderator", "super_admin"].includes(canonicalRole(role)); }

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req as Request & { user?: { role?: string } }).user?.role;
    if (!role || !hasPermission(role, permission)) return res.status(403).json({ error: "Insufficient permissions", code: "FORBIDDEN" });
    next();
  };
}

