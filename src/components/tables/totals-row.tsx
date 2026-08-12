import { cn } from "@/lib/utils";

/** Footer summary under a table: the same columns, aggregated, without the noise. */
export function TotalsRow({
  items,
  className,
}: {
  items: { label: string; value: string }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-6 gap-y-1.5", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
          <dd className="tabular text-[13px] font-medium">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
