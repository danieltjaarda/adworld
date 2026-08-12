"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { SidebarNav, type NavCounts } from "@/components/navigation/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function MobileNav({ counts }: { counts: NavCounts }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[276px] p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-14 items-center border-b border-border px-4">
          <Logo />
        </div>
        <div className="overflow-y-auto px-3 py-4">
          <SidebarNav counts={counts} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
