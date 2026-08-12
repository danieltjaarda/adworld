"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_SECTIONS, isActivePath } from "@/components/navigation/nav-config";
import { cn } from "@/lib/utils";

export type NavCounts = {
  recommendations: number;
  alerts: number;
};

export function SidebarNav({
  counts,
  onNavigate,
}: {
  counts: NavCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5" aria-label="Main">
      {NAV_SECTIONS.map((section, index) => (
        <div key={section.label ?? `section-${index}`} className="space-y-0.5">
          {section.label ? (
            <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
              {section.label}
            </p>
          ) : null}

          {section.items.map((item) => {
            const active = isActivePath(pathname, item.href);
            const count = item.badge ? counts[item.badge] : 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span className="flex-1 truncate">{item.label}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-semibold",
                      item.badge === "alerts"
                        ? "bg-negative-soft text-negative"
                        : "bg-info-soft text-info",
                    )}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
