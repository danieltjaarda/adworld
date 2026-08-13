import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, Callout, LegalHeading, Section } from "@/components/legal/prose";
import { COMPANY, LEGAL_LAST_UPDATED } from "@/lib/legal/company";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The agreement between you and AdLeverage: what the service does, what you are responsible for, how billing works and where the limits of our liability sit.",
};

export default function TermsPage() {
  return (
    <article>
      <LegalHeading
        title="Terms of service"
        updated={LEGAL_LAST_UPDATED}
        intro={`The agreement between you and ${COMPANY.legalName} for the use of ${COMPANY.product}. By creating a workspace you accept these terms.`}
      />

      <Section title="What the service does">
        <p>
          {COMPANY.product} connects to the Google Ads accounts you authorize, synchronizes their
          structure and performance data, calculates statistics from that data, and proposes changes
          with the reasoning and evidence behind them. Depending on the mode you choose it either
          waits for your approval or applies the change types you enabled, within the limits you
          configured.
        </p>
        <p>
          We may change, add or remove features. Where a change materially reduces what the service
          does, we tell you in advance.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          You need an account to use the service, and you are responsible for what happens under it,
          including everything done by the team members you invite. Keep your credentials to
          yourself and tell us promptly if you think they have been compromised. You must be at
          least 18 and able to enter into a contract.
        </p>
      </Section>

      <Section title="Connecting Google Ads">
        <p>
          By connecting an account you confirm that you are authorized to manage it and, where it
          belongs to someone else, that you have their permission to let {COMPANY.product} read and
          change it on their behalf. You remain responsible for complying with the Google Ads terms
          and policies that apply to that account.
        </p>
        <p>
          You can disconnect at any time from the{" "}
          <Link href="/accounts" className="text-foreground underline">
            Google Ads accounts
          </Link>{" "}
          page. Doing so stops all synchronization and all automatic changes for that account
          immediately.
        </p>
      </Section>

      <Section title="Automatic changes, and who answers for them">
        <p>
          This is the part worth reading twice. In Automatic mode the service makes changes to your
          live advertising account without asking first. You choose that mode, you choose which
          change types are enabled, and you set the limits. We build safeguards — hard caps on
          budget and bid movements that no configuration can exceed, a refusal to delete campaigns
          or touch conversion tracking, a confidence threshold, and a full audit log with one-click
          undo — but safeguards are not a guarantee.
        </p>
        <Callout>
          Advertising outcomes depend on your market, your offer and your competition. We do not
          promise any particular result, and you remain responsible for the spend on your account,
          including spend that follows from a change the service applied under a mode you enabled.
        </Callout>
        <p>
          If you are not comfortable with that, use Suggestions or Approval mode, in which nothing
          is written to your account without you clicking it.
        </p>
      </Section>

      <Section title="Acceptable use">
        <Bullets
          items={[
            "Do not use the service for advertising that breaks the law or Google Ads policy.",
            "Do not attempt to reach data belonging to another customer, probe the service for vulnerabilities without asking us first, or work around its rate limits and safety limits.",
            "Do not resell or white-label the service without a written agreement with us.",
            "Do not use the service to build a competing product, or to scrape it in bulk.",
          ]}
        />
        <p>
          Found a security issue? Mail{" "}
          <a href={`mailto:${COMPANY.contactEmail}`} className="text-foreground underline">
            {COMPANY.contactEmail}
          </a>{" "}
          and give us a reasonable window to fix it. We will not pursue researchers who act in good
          faith.
        </p>
      </Section>

      <Section title="Plans and payment">
        <p>
          Paid plans are billed monthly in advance through Stripe and renew automatically until you
          cancel. Prices are exclusive of VAT unless stated otherwise. Cancel whenever you like: the
          plan stays active until the end of the period you already paid for, and we do not refund
          partial months.
        </p>
        <p>
          Each plan carries limits on connected accounts, team members and monthly AI operations.
          When you reach a limit the service keeps working but stops the metered part until the next
          period or until you upgrade. If a payment fails we may suspend the workspace after
          notifying you.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          We aim for continuous availability but do not promise it. Maintenance, an outage at Google
          or at one of our providers, or a problem on our side can interrupt the service. Background
          jobs that fail are retried; a sync that could not run does not entitle you to a refund.
        </p>
      </Section>

      <Section title="Liability">
        <p>
          The service is provided as it is. To the extent the law allows, our total liability in any
          twelve-month period is limited to the amount you paid us in that period, and we are not
          liable for indirect or consequential loss, including lost profit, lost advertising revenue
          or the cost of advertising spend itself.
        </p>
        <p>
          Nothing here limits liability for intent, deliberate recklessness, or anything else that
          cannot be limited under Dutch law.
        </p>
      </Section>

      <Section title="Ending the agreement">
        <p>
          You can delete your workspace at any time from the organization settings, which ends the
          agreement. We can suspend or end it if you breach these terms, if payment fails and stays
          unpaid, or if we stop offering the service — in the last case we give you at least 30
          days&rsquo; notice and a way to export your data.
        </p>
      </Section>

      <Section title="Google">
        <p>
          {COMPANY.product} is an independent product. It is not affiliated with, endorsed by or
          sponsored by Google. Google Ads and Google are trademarks of Google LLC. Your use of data
          obtained through the Google Ads API is also subject to Google&rsquo;s own terms, and if
          Google changes or withdraws that access we may have to change the service accordingly.
        </p>
      </Section>

      <Section title="Applicable law">
        <p>
          Dutch law applies. Disputes go to the competent court in the district where{" "}
          {COMPANY.legalName} is established, unless mandatory consumer rules point somewhere else.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We will email workspace owners at least 30 days before a material change takes effect. If
          you do not agree, you can cancel before it does. Continuing to use the service after that
          date means you accept the new version.
        </p>
        <p>
          Questions about any of this:{" "}
          <a href={`mailto:${COMPANY.contactEmail}`} className="text-foreground underline">
            {COMPANY.contactEmail}
          </a>
          .
        </p>
      </Section>
    </article>
  );
}
