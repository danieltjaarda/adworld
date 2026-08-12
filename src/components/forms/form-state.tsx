"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for server-action forms. Every form in the product reports
 * success and failure the same way, so users never have to learn a new pattern.
 */

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string>;
};

export const idleState: ActionState = { status: "idle", message: "" };

export function SubmitButton({
  children,
  className,
  variant,
  size,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}

export function FormMessage({ state, className }: { state: ActionState; className?: string }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";

  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-[13px] leading-5",
        isError
          ? "border-negative/20 bg-negative-soft text-negative"
          : "border-positive/20 bg-positive-soft text-positive",
        className,
      )}
    >
      {state.message}
    </p>
  );
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-[12px] leading-4 text-negative">{error}</p>;
}
