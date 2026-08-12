"use server";

import { redirect } from "next/navigation";

import type { ActionState } from "@/components/forms/form-state";
import { getAuthContext } from "@/lib/auth/context";
import {
  login,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signup,
} from "@/lib/auth/service";
import { destroySession } from "@/lib/auth/session";
import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from "@/lib/auth/validation";
import { toUserMessage } from "@/lib/errors";

/**
 * Auth server actions.
 *
 * Each one validates with Zod, calls the service layer, and returns a message the form
 * can render. Redirects happen after the session cookie is set, never before.
 */

function invalid(error: unknown): ActionState {
  return { status: "error", message: toUserMessage(error) };
}

export async function signupAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    organizationName: formData.get("organizationName") || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await signup(parsed.data);
  } catch (error) {
    return invalid(error);
  }

  redirect("/onboarding");
}

export async function loginAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await login(parsed.data);
  } catch (error) {
    return invalid(error);
  }

  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function forgotPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Enter a valid email address.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  await requestPasswordReset(parsed.data.email);

  // Deliberately identical whether or not the address exists.
  return {
    status: "success",
    message: "If an account exists for that address, a reset link is on its way.",
  };
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
  } catch (error) {
    return invalid(error);
  }

  redirect("/login?reset=1");
}

export async function resendVerificationAction(): Promise<ActionState> {
  const context = await getAuthContext();
  if (!context) return { status: "error", message: "Sign in first." };
  if (context.user.emailVerifiedAt) {
    return { status: "success", message: "Your email address is already confirmed." };
  }

  await sendVerificationEmail(context.user.id, context.user.email);
  return { status: "success", message: "We sent a new confirmation link to your inbox." };
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
