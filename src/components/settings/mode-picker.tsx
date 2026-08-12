"use client";

import { Check, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

export type OptimizationModeValue = "SUGGESTIONS" | "APPROVAL" | "AUTOMATIC";

export const MODE_OPTIONS: {
  value: OptimizationModeValue;
  title: string;
  tagline: string;
  detail: string;
}[] = [
  {
    value: "SUGGESTIONS",
    title: "Suggestions only",
    tagline: "We never touch your account",
    detail:
      "The optimizer analyses every day and writes up what it would change, with the data behind it. Nothing is applied — you make the changes in Google Ads yourself.",
  },
  {
    value: "APPROVAL",
    title: "Approval required",
    tagline: "One click to apply",
    detail:
      "Changes are prepared and validated against Google Ads, then wait in your action center. Approve one and we apply it for you, with an undo where Google allows it.",
  },
  {
    value: "AUTOMATIC",
    title: "Automatic optimization",
    tagline: "Hands off, inside your limits",
    detail:
      "The types of change you allow are applied without waiting for you. Budget moves stay inside your daily caps, nothing is ever deleted, and everything lands in the audit log.",
  },
];

export function ModePicker({
  value,
  onChange,
  automaticLocked = false,
  automaticLockedReason,
  name = "mode",
}: {
  value: OptimizationModeValue;
  onChange: (value: OptimizationModeValue) => void;
  automaticLocked?: boolean;
  automaticLockedReason?: string;
  name?: string;
}) {
  return (
    <div className="space-y-2.5">
      {MODE_OPTIONS.map((option) => {
        const locked = option.value === "AUTOMATIC" && automaticLocked;
        const selected = value === option.value;

        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors",
              selected
                ? "border-primary bg-primary/[0.03] ring-1 ring-primary/20"
                : "border-border hover:border-border-strong hover:bg-secondary/40",
              locked && "cursor-not-allowed opacity-60 hover:border-border hover:bg-transparent",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              disabled={locked}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                selected ? "border-primary bg-primary text-primary-foreground" : "border-border-strong",
              )}
              aria-hidden
            >
              {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium">{option.title}</span>
                <span className="text-[12px] text-muted-foreground">{option.tagline}</span>
                {locked ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                    <Lock className="size-2.5" />
                    Growth plan
                  </span>
                ) : null}
              </span>
              <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">
                {locked && automaticLockedReason ? automaticLockedReason : option.detail}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
