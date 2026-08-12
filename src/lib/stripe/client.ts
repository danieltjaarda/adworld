import "server-only";

import Stripe from "stripe";

import { getEnv, features } from "@/lib/env";
import { errors } from "@/lib/errors";

/**
 * Stripe is optional infrastructure: without a secret key the app still runs, every
 * workspace sits on the Free plan, and the billing page explains that self-serve
 * checkout is not configured. Nothing else in the product has to know.
 */

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!features.stripe) {
    throw errors.configuration(
      "Billing is not configured on this deployment. Contact support to change your plan.",
    );
  }

  cached ??= new Stripe(getEnv().STRIPE_SECRET_KEY!, {
    apiVersion: "2026-07-29.dahlia",
    appInfo: { name: "AdLeverage", version: "0.1.0" },
    // Stripe's default 80s timeout outlives a serverless function; fail fast instead.
    timeout: 20_000,
    maxNetworkRetries: 2,
  });

  return cached;
}

export function isStripeConfigured(): boolean {
  return features.stripe;
}
