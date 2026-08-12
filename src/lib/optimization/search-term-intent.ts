import type { SearchTermIntent } from "@/generated/prisma/enums";

/**
 * Deterministic search-term intent classification.
 *
 * This runs before any model call: it is free, instant, and catches the obvious cases
 * (job hunters, DIY tutorials, software shoppers). The LLM is then only asked about
 * the terms this cannot confidently label, which keeps token spend proportional to the
 * genuinely ambiguous tail.
 */

type Rule = { pattern: RegExp; intent: SearchTermIntent; label: string };

/** Someone in this bucket is never going to become a customer. */
const IRRELEVANT_RULES: Rule[] = [
  { pattern: /\b(jobs?|vacature|vacancy|hiring|career|salary|salaris|internship|stage)\b/i, intent: "IRRELEVANT", label: "job seeker" },
  { pattern: /\b(worden|become a|how to become)\b/i, intent: "IRRELEVANT", label: "career research" },
  { pattern: /\b(course|cursus|training|opleiding|masterclass|workshop|leren)\b/i, intent: "IRRELEVANT", label: "wants training, not the service" },
  { pattern: /\b(free|gratis|torrent|crack|download|serial|keygen)\b/i, intent: "IRRELEVANT", label: "looking for something free" },
  { pattern: /\b(software|app|plugin|preset|template|apk)\b/i, intent: "IRRELEVANT", label: "shopping for tools, not services" },
  { pattern: /\b(wikipedia|meaning|definition|betekenis|wiki)\b/i, intent: "IRRELEVANT", label: "definition lookup" },
  { pattern: /\b(reddit|forum|quora)\b/i, intent: "IRRELEVANT", label: "community discussion" },
];

/** Research phase — real people, wrong moment. */
const LOW_INTENT_RULES: Rule[] = [
  { pattern: /\b(how to|hoe |what is|wat is|why |waarom |tutorial|guide|handleiding)\b/i, intent: "LOW_INTENT", label: "informational query" },
  { pattern: /\b(diy|zelf |yourself|myself)\b/i, intent: "LOW_INTENT", label: "do-it-yourself intent" },
  { pattern: /\b(ideas|inspiration|inspiratie|examples|voorbeelden|tips|checklist)\b/i, intent: "LOW_INTENT", label: "inspiration browsing" },
  { pattern: /\b(images?|photos?|foto|video's|youtube|pinterest)\b/i, intent: "LOW_INTENT", label: "media browsing" },
  { pattern: /\b(cheap|cheapest|goedkoop|goedkope|budget|discount|korting|second hand)\b/i, intent: "LOW_INTENT", label: "price-shopping below your positioning" },
];

/** Ready-to-buy signals. */
const HIGH_INTENT_RULES: Rule[] = [
  { pattern: /\b(near me|in de buurt|bij mij)\b/i, intent: "HIGH_INTENT", label: "local buying intent" },
  { pattern: /\b(hire|book|boek|boeken|huren|inhuren|aanvragen|offerte|quote|contact)\b/i, intent: "HIGH_INTENT", label: "explicit hiring intent" },
  { pattern: /\b(buy|kopen|order|bestellen|bestel)\b/i, intent: "HIGH_INTENT", label: "purchase intent" },
  { pattern: /\b(best|beste|top|professional|professionele|award)\b/i, intent: "HIGH_INTENT", label: "quality-led comparison" },
  { pattern: /\b(prijs|prijzen|price|prices|pricing|cost|kosten|tarief|rates)\b/i, intent: "MEDIUM_INTENT", label: "price research, close to buying" },
  { pattern: /\b(company|bedrijf|agency|bureau|service|diensten|studio)\b/i, intent: "MEDIUM_INTENT", label: "looking for a provider" },
];

export type IntentAssessment = {
  intent: SearchTermIntent;
  /** null when the deterministic rules cannot decide and a model should look. */
  reason: string | null;
  confident: boolean;
};

export function classifySearchTermText(text: string): IntentAssessment {
  const normalized = ` ${text.toLowerCase().trim()} `;

  for (const rule of IRRELEVANT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { intent: "IRRELEVANT", reason: `Matches ${rule.label}.`, confident: true };
    }
  }

  for (const rule of LOW_INTENT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { intent: "LOW_INTENT", reason: `Matches ${rule.label}.`, confident: true };
    }
  }

  for (const rule of HIGH_INTENT_RULES) {
    if (rule.pattern.test(normalized)) {
      return { intent: rule.intent, reason: `Matches ${rule.label}.`, confident: rule.intent === "HIGH_INTENT" };
    }
  }

  return { intent: "UNCLASSIFIED", reason: null, confident: false };
}

/**
 * Combines language signals with what actually happened. Performance always wins:
 * a term that converts is high intent no matter how it reads.
 */
export function classifySearchTerm(input: {
  text: string;
  clicks: number;
  cost: number;
  conversions: number;
  conversionValue: number;
}): IntentAssessment {
  if (input.conversions >= 2 || (input.conversions >= 1 && input.conversionValue > input.cost)) {
    return {
      intent: "HIGH_INTENT",
      reason: `Produced ${input.conversions} conversion${input.conversions === 1 ? "" : "s"} in the window.`,
      confident: true,
    };
  }

  const language = classifySearchTermText(input.text);
  if (language.confident) return language;

  if (input.clicks >= 10 && input.conversions === 0) {
    return {
      intent: "LOW_INTENT",
      reason: `${input.clicks} clicks without a conversion.`,
      confident: false,
    };
  }

  return language;
}

export const INTENT_LABELS: Record<SearchTermIntent, string> = {
  HIGH_INTENT: "High intent",
  MEDIUM_INTENT: "Medium intent",
  LOW_INTENT: "Low intent",
  IRRELEVANT: "Irrelevant",
  UNCLASSIFIED: "Unclassified",
};
