/**
 * Hierarchical Role System
 * user < agent < sub_admin < admin < super_admin < ultra_super_admin
 */

export type Role =
  | "user"
  | "agent"
  | "sub_admin"
  | "admin"
  | "super_admin"
  | "ultra_super_admin";

export const ROLE_HIERARCHY: Record<Role, number> = {
  user:              1,
  agent:             2,
  sub_admin:         3,
  admin:             4,
  super_admin:       5,
  ultra_super_admin: 6,
};

export const ROLE_LABELS: Record<Role, string> = {
  user:              "User",
  agent:             "Support Agent",
  sub_admin:         "Sub Admin",
  admin:             "Administrator",
  super_admin:       "Super Admin",
  ultra_super_admin: "Ulter Super Admin",

};

export const ROLE_COLORS: Record<Role, string> = {
  user:              "bg-gray-100 text-gray-700",
  agent:             "bg-blue-100 text-blue-700",
  sub_admin:         "bg-purple-100 text-purple-700",
  admin:             "bg-orange-100 text-orange-700",
  super_admin:       "bg-red-100 text-red-700",
  ultra_super_admin: "bg-gradient-to-r from-yellow-400 to-orange-500 text-white",
};

/** Returns true if actorRole can manage targetRole */
export function canManage(actorRole: Role, targetRole: Role): boolean {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

/** Returns all roles that actorRole can assign */
export function assignableRoles(actorRole: Role): Role[] {
  return (Object.keys(ROLE_HIERARCHY) as Role[]).filter(
    r => ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[r]
  );
}

/** Role-based permission checks */
export const Permissions = {
  // Can view all tickets in the system
  viewAllTickets: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["agent"],

  // Can create/edit tickets
  manageTickets: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["agent"],

  // Can approve/reject timesheets
  approveTimesheets: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["admin"],

  // Can manage users (grant/revoke roles)
  manageUsers: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["admin"],

  // Can manage dropdown lists (categories, services, groups etc.)
  manageDropdowns: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["super_admin"],

  // Can see everything but not control (read-only company-wide view)
  companyWideView: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["sub_admin"],

  // Can manage SLA policies
  manageSLA: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["admin"],

  // Can access system settings
  systemSettings: (role: Role) => ROLE_HIERARCHY[role] >= ROLE_HIERARCHY["super_admin"],

  // Full control over everything
  fullControl: (role: Role) => role === "ultra_super_admin",
};
