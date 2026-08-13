import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, Callout, DefinitionRow, LegalHeading, Section } from "@/components/legal/prose";
import { COMPANY, LEGAL_LAST_UPDATED, SUBPROCESSORS } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What AdLeverage collects from your Google account and Google Ads data, why, who it is shared with, and how to revoke access.",
};

export default function PrivacyPage() {
  return (
    <article>
      <LegalHeading
        title="Privacy policy"
        updated={LEGAL_LAST_UPDATED}
        intro={`How ${COMPANY.legalName} handles your personal data and your Google Ads data when you use ${COMPANY.product}.`}
      />

      <Section title="Who is responsible">
        <p>
          {COMPANY.product} is operated by {COMPANY.legalName}, {COMPANY.address} (Chamber of
          Commerce {COMPANY.kvk}, VAT {COMPANY.vat}). For anything in this policy, including access
          and deletion requests, write to{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`} className="text-foreground underline">
            {COMPANY.privacyEmail}
          </a>
          . We answer data-subject requests within 30 days.
        </p>
        <p>
          For the data in your workspace we act as processor and you are the controller: it is your
          advertising data, and we only touch it to deliver the service you asked for. For your own
          account and billing details we are the controller.
        </p>
      </Section>

      <Section title="What we collect">
        <dl>
          <DefinitionRow term="Account details">
            Your email address, name, an optional profile picture, your locale and timezone, and —
            if you signed up with a password rather than Google — a scrypt hash of that password. We
            never store the password itself.
          </DefinitionRow>
          <DefinitionRow term="Sign-in and sessions">
            A hash of each session token, the time it was last used, and the IP address and browser
            user-agent it was created from, so you can see and revoke your active sessions.
          </DefinitionRow>
          <DefinitionRow term="Google account data">
            When you sign in with Google or connect Google Ads: your Google account identifier,
            email address, name and profile picture, plus the OAuth access and refresh tokens that
            let us call the Google Ads API on your behalf.
          </DefinitionRow>
          <DefinitionRow term="Google Ads data">
            From each account you connect: campaigns, ad groups, keywords, ads, search terms,
            conversion actions, and up to 90 days of daily performance metrics and segments. This is
            advertising performance data. It contains no data about the people who saw or clicked
            your ads, and Google does not expose such data to us.
          </DefinitionRow>
          <DefinitionRow term="Your use of the product">
            Which changes you approved, dismissed or undid, and an audit log entry for each
            sensitive action, including the acting user, the IP address and the before-and-after
            state, so a change can always be traced and reversed.
          </DefinitionRow>
          <DefinitionRow term="Billing">
            Your plan, subscription status and invoices. Card details are entered directly with
            Stripe and never reach our servers.
          </DefinitionRow>
        </dl>
      </Section>

      <Section title="Why we use it">
        <Bullets
          items={[
            "To run the product: syncing your accounts, calculating statistics, generating recommendations and applying the changes you allow.",
            "To keep your account secure: authentication, session management, rate limiting and abuse prevention.",
            "To bill you for the plan you chose, and to send transactional email such as verification, password resets and the weekly digest you can switch off.",
            "To debug and improve the service, using logs from which tokens and secrets are stripped before they are written.",
          ]}
        />
        <p>
          We do not sell personal data, we do not use your data for advertising, and we do not build
          profiles of you across other services.
        </p>
      </Section>

      <Section title="Google user data and Limited Use">
        <p>
          Access to Google Ads runs through Google&rsquo;s OAuth with the{" "}
          <code className="rounded bg-canvas px-1 py-0.5 text-[13px]">adwords</code> scope, which you
          grant explicitly and can withdraw at any time.
        </p>
        <Callout>
          {COMPANY.product}&rsquo;s use and transfer of information received from Google APIs adheres
          to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="underline"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </Callout>
        <p>Concretely, that means:</p>
        <Bullets
          items={[
            "We read your Google Ads data only to provide features you can see in the product, and we write to your account only in the mode you selected — never in Suggestions mode, and only within the budget and bid limits you configured.",
            "We do not transfer Google user data to anyone except the sub-processors listed below, and only where they are needed to run the service.",
            "We do not use Google user data to serve advertising, and we do not sell it.",
            "No human at our company reads your Google Ads data, except when you ask us for support and give us permission, or where the law requires it.",
            "Google user data is not used to train generalized artificial-intelligence models. Where a language model is used to explain a recommendation or draft ad copy, the data is sent for that single request only, and our provider is contractually barred from training on it.",
          ]}
        />
        <p>
          Your Google refresh token is encrypted with AES-256-GCM before it is stored, is decrypted
          only inside the server that makes the API call, and is never sent to your browser.
        </p>
      </Section>

      <Section title="Who else processes your data">
        <p>
          We use a small number of sub-processors. Each is bound by a data-processing agreement and
          receives only what it needs.
        </p>
        <dl>
          {SUBPROCESSORS.map(([name, purpose, region]) => (
            <DefinitionRow key={name} term={name}>
              {purpose} · {region}
            </DefinitionRow>
          ))}
        </dl>
        <p>
          Transfers outside the European Economic Area rest on the European Commission&rsquo;s
          Standard Contractual Clauses. We publish changes to this list here before they take
          effect.
        </p>
      </Section>

      <Section title="How long we keep it">
        <Bullets
          items={[
            "Google Ads data and derived statistics: for as long as the account is connected, plus 30 days after you disconnect it.",
            "Account and workspace data: until you delete the workspace, after which it is removed within 30 days.",
            "Audit logs: 24 months, because they exist to reconstruct who changed what.",
            "Invoices and billing records: seven years, as Dutch tax law requires.",
            "OAuth tokens: deleted immediately when you disconnect the Google account or revoke access from your Google account settings.",
          ]}
        />
      </Section>

      <Section title="How it is protected">
        <Bullets
          items={[
            "Every row that belongs to a workspace carries its identifier, and every query is filtered by the workspace resolved from your session — never from anything the browser sends.",
            "Passwords are hashed with scrypt; session, verification and invitation tokens are stored only as SHA-256 hashes, so a database dump cannot be replayed.",
            "OAuth refresh tokens are encrypted at rest with AES-256-GCM.",
            "Session cookies are httpOnly, sameSite=lax and secure. Authentication endpoints are rate limited.",
            "Logs redact tokens and secrets before they are written.",
          ]}
        />
      </Section>

      <Section title="Your rights">
        <p>
          Under the GDPR you can request access to your data, correction, deletion, restriction of
          processing, and a portable copy, and you can object to processing. Write to{" "}
          <a href={`mailto:${COMPANY.privacyEmail}`} className="text-foreground underline">
            {COMPANY.privacyEmail}
          </a>
          . You can also lodge a complaint with the Dutch Data Protection Authority, the Autoriteit
          Persoonsgegevens.
        </p>
        <p>
          You do not need us to withdraw Google access. Disconnect the account on the{" "}
          <Link href="/accounts" className="text-foreground underline">
            Google Ads accounts
          </Link>{" "}
          page, or remove {COMPANY.product} from{" "}
          <a
            href="https://myaccount.google.com/permissions"
            className="text-foreground underline"
            target="_blank"
            rel="noreferrer"
          >
            your Google account permissions
          </a>
          . Either way we stop being able to reach your Ads account, and the stored tokens become
          useless.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We set one cookie to keep you signed in, and two small preference cookies that remember
          which workspace and which Ads account you were last looking at. There are no advertising
          or analytics cookies, so there is no consent banner to click away.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          When this policy changes materially we email every workspace owner before the new version
          takes effect. The date at the top always reflects the current version.
        </p>
      </Section>
    </article>
  );
}
