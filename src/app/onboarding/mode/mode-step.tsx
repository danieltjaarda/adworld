"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ModePicker, type OptimizationModeValue } from "@/components/settings/mode-picker";
import { Button } from "@/components/ui/button";

export function ModeStep({
  initialMode,
  automaticAllowed,
  planName,
}: {
  initialMode: OptimizationModeValue;
  automaticAllowed: boolean;
  planName: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<OptimizationModeValue>(
    initialMode === "AUTOMATIC" && !automaticAllowed ? "APPROVAL" : initialMode,
  );

  return (
    <div className="space-y-6">
      <ModePicker
        value={mode}
        onChange={setMode}
        automaticLocked={!automaticAllowed}
        automaticLockedReason={`Automatic execution is not included in the ${planName} plan. Upgrade later — approvals stay one click either way.`}
      />

      <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
        <Button variant="ghost" asChild>
          <Link href="/onboarding/select">Back</Link>
        </Button>
        <Button onClick={() => router.push(`/onboarding/goals?mode=${mode}`)}>Continue</Button>
      </div>
    </div>
  );
}
