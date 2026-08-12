import { NextResponse } from "next/server";

import { isAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { constructEvent, handleStripeEvent } from "@/lib/stripe/webhook";

/**
 * Stripe webhook endpoint.
 *
 * Signature verification needs the raw body, so this route reads text and never parses
 * JSON itself. A 2xx is returned for anything we understood — including duplicates —
 * because a non-2xx makes Stripe retry, and retrying a permanent failure is pointless.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("api.stripe.webhook");

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event;
  try {
    event = constructEvent(payload, signature);
  } catch (error) {
    log.warn("rejected webhook", { error: isAppError(error) ? error.code : "unknown" });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, handled: result.handled });
  } catch (error) {
    // Genuine processing failures do get a 500 so Stripe retries them.
    log.error("webhook processing failed", { error, type: event.type, id: event.id });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
