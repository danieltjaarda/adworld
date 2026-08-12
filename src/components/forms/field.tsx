import { FieldError } from "@/components/forms/form-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Labelled input with optional unit affix and helper text. Used by onboarding and every
 * settings form so numeric goals always look and behave the same.
 */
export function Field({
  name,
  label,
  hint,
  error,
  prefix,
  suffix,
  className,
  ...props
}: React.ComponentProps<typeof Input> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name} className="text-[13px] font-medium">
        {label}
      </Label>

      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-[13px] text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <Input
          id={name}
          name={name}
          aria-invalid={error ? true : undefined}
          className={cn(prefix && "pl-7", suffix && "pr-9")}
          {...props}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-[13px] text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>

      {error ? <FieldError error={error} /> : hint ? (
        <p className="text-[12px] leading-4 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
