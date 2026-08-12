import {
  AlertTriangle,
  BarChart3,
  Building2,
  CreditCard,
  FileText,
  LayoutDashboard,
  Lightbulb,
  MessageSquare,
  Megaphone,
  Search,
  Settings,
  Tag,
  Wand2,
} from "lucide-react";

/**
 * Navigation is data, not markup, so the sidebar, the mobile sheet and the command
 * palette can never drift apart.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown as a small count on the right, resolved by the layout. */
  badge?: "recommendations" | "alerts";
};

export type NavSection = {
  label: string | null;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: null,
    items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Performance",
    items: [
      { href: "/campaigns", label: "Campaigns", icon: Megaphone },
      { href: "/keywords", label: "Keywords", icon: Tag },
      { href: "/search-terms", label: "Search terms", icon: Search },
      { href: "/ads", label: "Ads", icon: BarChart3 },
    ],
  },
  {
    label: "Optimization",
    items: [
      { href: "/ai", label: "AI agent", icon: MessageSquare },
      { href: "/optimizer", label: "AI optimizer", icon: Wand2 },
      { href: "/recommendations", label: "Recommendations", icon: Lightbulb, badge: "recommendations" },
      { href: "/alerts", label: "Alerts", icon: AlertTriangle, badge: "alerts" },
      { href: "/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/accounts", label: "Google Ads accounts", icon: Building2 },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/billing", label: "Billing", icon: CreditCard },
    ],
  },
];

export const SETTINGS_NAV: Array<{ href: string; label: string; description: string }> = [
  { href: "/settings", label: "Profile", description: "Your name, email and password" },
  { href: "/settings/organization", label: "Organization", description: "Workspace name and defaults" },
  { href: "/settings/optimization", label: "AI optimization", description: "Mode, targets and safety limits" },
  { href: "/settings/notifications", label: "Notifications", description: "What we email you about" },
  { href: "/settings/security", label: "Security", description: "Password and active sessions" },
  { href: "/settings/team", label: "Team", description: "Members, roles and invitations" },
  { href: "/settings/audit-log", label: "Audit log", description: "Every change, who made it and why" },
];

/** Longest-prefix match so /settings/team highlights Settings, not Overview. */
export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}
