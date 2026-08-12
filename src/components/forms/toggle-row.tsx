"use client";

import { useId, useState } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * A labelled switch that also posts with a plain form. The hidden checkbox is what the
 * server action reads, so no client state has to be serialized separately.
 */
export function ToggleRow({
  name,
  label,
  description,
  defaultChecked,
  disabled,
  className,
}: {
  name: string;
  label: string;
  description?: string;
  defaultChecked: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border py-3 last:border-0",
        className,
      )}
    >
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <input type="checkbox" name={name} checked={checked} readOnly hidden />
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={setChecked}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
