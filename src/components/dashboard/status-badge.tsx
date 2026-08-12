import { cn } from "@/lib/utils";

export type Tone = "neutral" | "positive" | "negative" | "warning" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
};

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Entity status shares a vocabulary across campaigns, ad groups, keywords and ads. */
export function EntityStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "ENABLED"
      ? "positive"
      : status === "PAUSED"
        ? "warning"
        : status === "REMOVED"
          ? "negative"
          : "neutral";

  const label = status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

export function RiskBadge({ risk }: { risk: "LOW" | "MEDIUM" | "HIGH" }) {
  const tone: Tone = risk === "LOW" ? "positive" : risk === "MEDIUM" ? "warning" : "negative";
  return <StatusBadge tone={tone}>{risk.toLowerCase()} risk</StatusBadge>;
}
