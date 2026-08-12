"use client";

import Link from "next/link";
import { CreditCard, LogOut, Settings, ShieldCheck } from "lucide-react";

import { logoutAction } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsFrom } from "@/lib/utils";

export function UserMenu({
  name,
  email,
  imageUrl,
  role,
}: {
  name: string | null;
  email: string;
  imageUrl: string | null;
  role: string;
}) {
  const display = name?.trim() || email;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar comes from Google's CDN
          <img
            src={imageUrl}
            alt=""
            className="size-7 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
            {initialsFrom(display)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-4">{display}</span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">{role}</span>
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="top" className="w-[240px]">
        <div className="px-2 py-1.5">
          <p className="truncate text-[13px] font-medium">{display}</p>
          <p className="truncate text-[12px] text-muted-foreground">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings" className="gap-2">
            <Settings className="size-4 text-muted-foreground" aria-hidden />
            Profile settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/security" className="gap-2">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/billing" className="gap-2">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden />
            Billing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] outline-hidden transition-colors hover:bg-muted"
          >
            <LogOut className="size-4 text-muted-foreground" aria-hidden />
            Sign out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
