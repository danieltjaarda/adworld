import "server-only";

import { features, getEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";

/**
 * Email provider abstraction. Resend is used when configured; otherwise messages are
 * logged so local development still exercises the full flow (the verification link is
 * printed to the terminal).
 */

const log = createLogger("notifications.email");

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export type EmailProvider = {
  readonly name: string;
  send(message: EmailMessage): Promise<{ id: string | null; delivered: boolean }>;
};

const consoleProvider: EmailProvider = {
  name: "console",
  async send(message) {
    log.info("email (console provider)", {
      to: message.to,
      subject: message.subject,
      preview: message.text.slice(0, 500),
    });
    return { id: null, delivered: false };
  },
};

const resendProvider: EmailProvider = {
  name: "resend",
  async send(message) {
    const env = getEnv();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.error("resend delivery failed", { status: response.status, body: body.slice(0, 300) });
      return { id: null, delivered: false };
    }

    const payload = (await response.json()) as { id?: string };
    return { id: payload.id ?? null, delivered: true };
  },
};

export function getEmailProvider(): EmailProvider {
  return features.email ? resendProvider : consoleProvider;
}

/** Never throws: a failed notification must not break the surrounding transaction. */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  try {
    const provider = getEmailProvider();
    const result = await provider.send(message);
    return result.delivered;
  } catch (error) {
    log.error("email send threw", { error, to: message.to, subject: message.subject });
    return false;
  }
}
