import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Native select on purpose: the full IANA list is long, and the browser's own picker
 * (with type-ahead) beats anything custom here.
 */

const COMMON_ZONES = [
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Europe/Stockholm",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];

export function TimezoneSelect({
  name,
  label,
  defaultValue,
  hint,
  className,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  className?: string;
}) {
  const zones = COMMON_ZONES.includes(defaultValue)
    ? COMMON_ZONES
    : [defaultValue, ...COMMON_ZONES];

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name} className="text-[13px] font-medium">
        {label}
      </Label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {hint ? <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
