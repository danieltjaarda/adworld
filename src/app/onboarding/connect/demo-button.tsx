"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createDemoAccountAction } from "@/app/(dashboard)/accounts/actions";
import { Button } from "@/components/ui/button";

export function DemoAccountButton({ label = "Explore with demo data" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="lg"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await createDemoAccountAction();
          if (result.status === "success") {
            router.push("/onboarding/mode");
          } else {
            toast.error("Could not create demo account", { description: result.message });
          }
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending ? "Generating 90 days of history…" : label}
    </Button>
  );
}
