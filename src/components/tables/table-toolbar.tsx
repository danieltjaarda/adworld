"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Filters live in the URL, not in component state: a filtered table is shareable,
 * survives a refresh, and needs no client-side data fetching.
 */

function useParamWriter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function write(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return { write, pending };
}

export function TableSearch({
  placeholder = "Search",
  paramKey = "q",
  className,
}: {
  placeholder?: string;
  paramKey?: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const { write } = useParamWriter();
  const initial = searchParams.get(paramKey) ?? "";
  const [value, setValue] = useState(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adjust during render when the URL changed from elsewhere (back button, filter reset).
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setValue(initial);
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function update(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => write({ [paramKey]: next || null }), 250);
  }

  return (
    <div className={cn("relative w-full sm:w-56", className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => update(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => update("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export type FilterOption = { value: string; label: string; count?: number };

export function FilterTabs({
  paramKey,
  options,
  active,
  className,
}: {
  paramKey: string;
  options: FilterOption[];
  active: string;
  className?: string;
}) {
  const { write } = useParamWriter();

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} role="group">
      {options.map((option) => {
        const selected = option.value === active;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => write({ [paramKey]: option.value === "all" ? null : option.value })}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
              selected
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={cn("ml-1.5 tabular", selected ? "text-muted-foreground" : "")}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
