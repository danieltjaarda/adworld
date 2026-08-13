/**
 * The operator behind AdLeverage, in one place.
 *
 * Google's OAuth verification, Stripe and the GDPR all want to see the same identity
 * details, and a privacy policy that names a different entity than the invoice is worse
 * than no policy at all. Fill these in once; the legal pages read from here.
 *
 * TODO(daniel): the postcode and city are still placeholders, and Google emails the
 * contact address during verification — point it somewhere that is actually read.
 */
export const COMPANY = {
  /** Trading name of the product. */
  product: "AdLeverage",
  /** Registered legal entity that operates the product. */
  legalName: "Noord Trading B.V.",
  /** Registered address, as it appears in the Chamber of Commerce register. */
  address: "Brandemeer 4a, [Postcode] [City], The Netherlands",
  /** Dutch Chamber of Commerce number. */
  kvk: "96813091",
  /** VAT identification number. */
  vat: "NL867772979B01",
  /** Reaches a human for support and contract questions. */
  contactEmail: "daniel@deskna.nl",
  /** Reaches whoever handles data-protection requests. */
  privacyEmail: "daniel@deskna.nl",
  /** Public URL of the deployment these terms apply to. */
  siteUrl: "https://adworld-p4r3.vercel.app",
} as const;

/** Shown as "Last updated" on both legal pages. Bump when the text changes. */
export const LEGAL_LAST_UPDATED = "13 August 2026";

/**
 * Everyone who processes customer data on our behalf. Google asks for this list during
 * verification and the GDPR requires it to be available to customers on request.
 */
export const SUBPROCESSORS = [
  ["Vercel Inc.", "Application hosting and logs", "United States / EU region"],
  ["Neon Inc.", "PostgreSQL database", "EU (Frankfurt)"],
  ["Stripe Inc.", "Subscription billing and payment data", "United States / EU"],
  ["Resend Inc.", "Transactional email", "United States"],
  ["OpenAI, L.L.C.", "Language model for explanations and ad copy drafts", "United States"],
  ["Upstash Inc.", "Rate limiting", "EU"],
  ["Google LLC", "Google Ads API and Google sign-in", "United States / EU"],
] as const;
