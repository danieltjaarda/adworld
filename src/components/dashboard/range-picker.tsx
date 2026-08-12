"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RANGE_PRESETS, type RangePreset } from "@/lib/analytics/date-range";
import { cn } from "@/lib/utils";

/**
 * Range selection lives in the URL, so a filtered view is shareable, bookmarkable and
 * survives a refresh. The server reads the same parameters and renders accordingly.
 */
export function RangePicker({
  preset,
  start,
  end,
  compact = false,
}: {
  preset: RangePreset;
  start: string;
  end: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function apply(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const quick = RANGE_PRESETS.filter((option) =>
    compact
      ? ["last_7", "last_30", "last_90"].includes(option.value)
      : ["today", "last_7", "last_30", "last_90"].includes(option.value),
  );

  return (
    <div className={cn("flex items-center gap-1.5", pending && "opacity-70")}>
      <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
        {quick.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => apply({ range: option.value, start: null, end: null })}
            className={cn(
              "h-7 rounded-md px-2.5 text-[12px] font-medium transition-colors",
              preset === option.value
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {compact ? option.shortLabel : option.label.replace("Last ", "")}
          </button>
        ))}
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn("h-8 gap-1.5", preset === "custom" && "border-primary/40 text-primary")}
          >
            <CalendarDays className="size-3.5" />
            <span className="hidden sm:inline">
              {preset === "custom" ? `${start} → ${end}` : "Custom"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[280px] space-y-3">
          <p className="text-[13px] font-medium">Custom range</p>
          <form
            className="space-y-3"
            action={(formData) => {
              const from = String(formData.get("start") ?? "");
              const to = String(formData.get("end") ?? "");
              if (!from || !to) return;
              apply({ range: "custom", start: from, end: to });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="range-start" className="text-[12px]">
                From
              </Label>
              <Input id="range-start" name="start" type="date" defaultValue={start} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-end" className="text-[12px]">
                To
              </Label>
              <Input id="range-end" name="end" type="date" defaultValue={end} required />
            </div>
            <Button type="submit" size="sm" className="w-full">
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
