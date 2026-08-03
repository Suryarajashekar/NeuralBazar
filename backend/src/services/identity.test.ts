import assert from "node:assert/strict";
import test from "node:test";
import { canonicalRole, hasPermission, isCreator, isStaff, isSuperAdmin } from "./identity";
import { normalizeUsername, usernameChangeAllowed } from "./username";

test("legacy roles map to the enterprise roles", () => {
  assert.equal(canonicalRole("buyer"), "customer");
  assert.equal(canonicalRole("admin"), "super_admin");
  assert.equal(isSuperAdmin("admin"), true);
  assert.equal(isCreator("super_admin"), true);
  assert.equal(isStaff("support_admin"), true);
});

test("permission inheritance does not grant customer admin access", () => {
  assert.equal(hasPermission("customer", "marketplace.purchase"), true);
  assert.equal(hasPermission("creator", "model.upload"), true);
  assert.equal(hasPermission("support_admin", "admin.financial.read"), false);
  assert.equal(hasPermission("moderator", "admin.roles.manage"), false);
  assert.equal(hasPermission("super_admin", "admin.audit.read"), true);
});

test("usernames are normalized and reserved names are rejected", () => {
  assert.equal(normalizeUsername("  Alice.Dev  "), "alice.dev");
  assert.throws(() => normalizeUsername("admin"), /reserved/i);
  assert.throws(() => normalizeUsername("ab"), /at least 3 character/i);
});

test("username changes are limited to 30 days", () => {
  const now = new Date("2026-08-04T00:00:00.000Z");
  assert.equal(usernameChangeAllowed(null, now), true);
  assert.equal(usernameChangeAllowed(new Date("2026-07-20T00:00:00.000Z"), now), false);
  assert.equal(usernameChangeAllowed(new Date("2026-07-05T00:00:00.000Z"), now), true);
});
