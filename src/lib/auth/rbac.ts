import type { OrganizationRole } from "@/generated/prisma/enums";

/**
 * Role → permission matrix. Authorization is always answered here rather than by
 * ad-hoc role comparisons scattered through route handlers.
 */

export type Permission =
  | "org:read"
  | "org:manage"
  | "org:delete"
  | "team:read"
  | "team:manage"
  | "billing:read"
  | "billing:manage"
  | "accounts:read"
  | "accounts:manage"
  | "settings:read"
  | "settings:manage"
  | "data:read"
  | "recommendations:review"
  | "actions:execute"
  | "ai:chat"
  | "audit:read";

const ROLE_PERMISSIONS: Record<OrganizationRole, readonly Permission[]> = {
  OWNER: [
    "org:read",
    "org:manage",
    "org:delete",
    "team:read",
    "team:manage",
    "billing:read",
    "billing:manage",
    "accounts:read",
    "accounts:manage",
    "settings:read",
    "settings:manage",
    "data:read",
    "recommendations:review",
    "actions:execute",
    "ai:chat",
    "audit:read",
  ],
  ADMIN: [
    "org:read",
    "org:manage",
    "team:read",
    "team:manage",
    "billing:read",
    "accounts:read",
    "accounts:manage",
    "settings:read",
    "settings:manage",
    "data:read",
    "recommendations:review",
    "actions:execute",
    "ai:chat",
    "audit:read",
  ],
  MEMBER: [
    "org:read",
    "team:read",
    "accounts:read",
    "settings:read",
    "settings:manage",
    "data:read",
    "recommendations:review",
    "actions:execute",
    "ai:chat",
    "audit:read",
  ],
  VIEWER: ["org:read", "team:read", "accounts:read", "settings:read", "data:read", "ai:chat"],
};

export function can(role: OrganizationRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: OrganizationRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export const ASSIGNABLE_ROLES: readonly OrganizationRole[] = ["ADMIN", "MEMBER", "VIEWER"];
