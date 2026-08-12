import type { EmailMessage } from "@/lib/notifications/email";

/** Plain, deliverable HTML — table-free, inline styles, no external assets. */

const BRAND = "AdLeverage";

function layout(options: {
  heading: string;
  intro: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footer?: string;
}): string {
  const { heading, intro, bodyHtml = "", ctaLabel, ctaUrl, footer } = options;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e8ee;border-radius:12px;padding:32px;">
      <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#0f172a;margin-bottom:24px;">${BRAND}</div>
      <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.02em;">${heading}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#4b5563;">${intro}</p>
      ${bodyHtml}
      ${
        ctaLabel && ctaUrl
          ? `<a href="${ctaUrl}" style="display:inline-block;margin:8px 0 20px;background:#635bff;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px;">${ctaLabel}</a>
      <p style="margin:0 0 8px;font-size:12px;line-height:18px;color:#6b7280;">Or paste this link into your browser:<br /><span style="color:#635bff;word-break:break-all;">${ctaUrl}</span></p>`
          : ""
      }
      <hr style="border:none;border-top:1px solid #e3e8ee;margin:24px 0 16px;" />
      <p style="margin:0;font-size:12px;line-height:18px;color:#6b7280;">${
        footer ?? `${BRAND} — AI optimization for Google Ads.`
      }</p>
    </div>
  </body>
</html>`;
}

export function verifyEmailTemplate(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Confirm your ${BRAND} email address`,
    html: layout({
      heading: "Confirm your email address",
      intro: "Confirm this address to secure your account and enable email reports and alerts.",
      ctaLabel: "Confirm email",
      ctaUrl: url,
      footer: "This link expires in 24 hours. If you did not create an account, ignore this email.",
    }),
    text: `Confirm your email address for ${BRAND}: ${url} (expires in 24 hours)`,
  };
}

export function passwordResetTemplate(to: string, url: string): EmailMessage {
  return {
    to,
    subject: `Reset your ${BRAND} password`,
    html: layout({
      heading: "Reset your password",
      intro: "Choose a new password for your account. This link can only be used once.",
      ctaLabel: "Reset password",
      ctaUrl: url,
      footer: "This link expires in 1 hour. If you did not request it, no action is needed.",
    }),
    text: `Reset your ${BRAND} password: ${url} (expires in 1 hour)`,
  };
}

export function invitationTemplate(options: {
  to: string;
  url: string;
  organizationName: string;
  inviterName: string;
}): EmailMessage {
  return {
    to: options.to,
    subject: `${options.inviterName} invited you to ${options.organizationName}`,
    html: layout({
      heading: `Join ${options.organizationName}`,
      intro: `${options.inviterName} invited you to collaborate on Google Ads optimization in ${BRAND}.`,
      ctaLabel: "Accept invitation",
      ctaUrl: options.url,
      footer: "This invitation expires in 7 days.",
    }),
    text: `${options.inviterName} invited you to ${options.organizationName} on ${BRAND}: ${options.url}`,
  };
}

export function alertTemplate(options: {
  to: string;
  title: string;
  body: string;
  accountName: string;
  url: string;
}): EmailMessage {
  return {
    to: options.to,
    subject: `${options.title} — ${options.accountName}`,
    html: layout({
      heading: options.title,
      intro: options.body,
      bodyHtml: `<p style="margin:0 0 16px;font-size:13px;color:#6b7280;">Account: ${options.accountName}</p>`,
      ctaLabel: "Open dashboard",
      ctaUrl: options.url,
    }),
    text: `${options.title}\n\n${options.body}\n\n${options.url}`,
  };
}

export function weeklyDigestTemplate(options: {
  to: string;
  accountName: string;
  summary: string;
  rows: Array<{ label: string; value: string; change?: string }>;
  url: string;
}): EmailMessage {
  const rowsHtml = options.rows
    .map(
      (row) =>
        `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <span style="color:#6b7280;">${row.label}</span>
          <strong style="color:#0f172a;">${row.value}${
            row.change ? ` <span style="color:#6b7280;font-weight:400;">(${row.change})</span>` : ""
          }</strong>
        </div>`,
    )
    .join("");

  return {
    to: options.to,
    subject: `Weekly performance — ${options.accountName}`,
    html: layout({
      heading: `Weekly performance`,
      intro: options.summary,
      bodyHtml: `<div style="margin:0 0 20px;">${rowsHtml}</div>`,
      ctaLabel: "View full report",
      ctaUrl: options.url,
    }),
    text: `${options.summary}\n\n${options.rows
      .map((row) => `${row.label}: ${row.value}${row.change ? ` (${row.change})` : ""}`)
      .join("\n")}\n\n${options.url}`,
  };
}
