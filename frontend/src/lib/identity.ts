export type AppRole = "customer" | "creator" | "support_admin" | "moderator" | "super_admin" | "buyer" | "admin";

export function canonicalRole(role?: string) {
  if (role === "buyer") return "customer";
  if (role === "admin") return "super_admin";
  return role ?? "customer";
}

export function isSuperAdmin(role?: string) { return canonicalRole(role) === "super_admin"; }
export function isCreator(role?: string) { return canonicalRole(role) === "creator" || isSuperAdmin(role); }
export function isModerator(role?: string) { return canonicalRole(role) === "moderator" || isSuperAdmin(role); }
export function isStaff(role?: string) { return ["support_admin", "moderator", "super_admin"].includes(canonicalRole(role)); }
export function roleLabel(role?: string) { return ({ customer: "Customer", creator: "Creator", support_admin: "Support Admin", moderator: "Moderator", super_admin: "Super Admin", buyer: "Customer", admin: "Super Admin" } as Record<string, string>)[role ?? "customer"] ?? "Customer"; }
