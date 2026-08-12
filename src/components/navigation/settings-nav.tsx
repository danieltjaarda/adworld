"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { SETTINGS_NAV } from "@/components/navigation/nav-config";
import { cn } from "@/lib/utils";

/** Vertical on desktop, a scrollable strip on mobile. Same links either way. */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {SETTINGS_NAV.map((item) => {
          const active =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              <Link
                href={item.href}
                className={cn(
                  "block rounded-lg px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors lg:whitespace-normal",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item.label}
                <span className="hidden text-[12px] font-normal text-muted-foreground lg:mt-0.5 lg:block">
                  {item.description}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
