import "server-only";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { sleep } from "@/lib/utils";

/**
 * Minimal Google Ads REST transport.
 *
 * The official gRPC client pulls in a large native dependency tree that is awkward on
 * serverless; the REST surface exposes everything this product needs (GAQL search plus
 * the mutate endpoints) over plain fetch.
 */

const log = createLogger("google-ads.client");

const API_HOST = "https://googleads.googleapis.com";
const MAX_ATTEMPTS = 3;
const PAGE_SIZE = 10_000;

export type GoogleAdsClientOptions = {
  accessToken: string;
  customerId: string;
  /** Manager account id, required when the customer is managed by an MCC. */
  loginCustomerId?: string | null;
};

type GoogleAdsErrorDetail = {
  errorCode?: Record<string, string>;
  message?: string;
  trigger?: unknown;
  location?: unknown;
};

type GoogleAdsErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ errors?: GoogleAdsErrorDetail[] }>;
  };
};

/** Digits only — Google rejects ids that contain dashes. */
export function normalizeCustomerId(customerId: string): string {
  return customerId.replace(/\D/g, "");
}

function firstErrorCode(body: GoogleAdsErrorBody): string | null {
  const detail = body.error?.details?.[0]?.errors?.[0];
  if (!detail?.errorCode) return null;
  const [group, code] = Object.entries(detail.errorCode)[0] ?? [];
  return group && code ? `${group}.${code}` : null;
}

/** Google returns the error group in camelCase; comparisons here ignore case. */
function codeIncludes(code: string | null, needle: string): boolean {
  return code !== null && code.toLowerCase().includes(needle.toLowerCase());
}

/** Maps Google's failure payloads onto messages a marketer can act on. */
export function mapGoogleAdsError(status: number, body: GoogleAdsErrorBody): AppError {
  const code = firstErrorCode(body);
  const detailMessage = body.error?.details?.[0]?.errors?.[0]?.message ?? body.error?.message;

  const internalMessage = `Google Ads API ${status}${code ? ` (${code})` : ""}: ${
    detailMessage ?? "unknown error"
  }`;

  if (status === 401) {
    return new AppError(
      "GOOGLE_AUTH",
      "Google rejected our credentials for this account. Reconnect it to continue.",
      { internalMessage },
    );
  }

  if (status === 403) {
    if (codeIncludes(code, "AuthorizationError.USER_PERMISSION_DENIED")) {
      return new AppError(
        "GOOGLE_ADS_API",
        "This Google login does not have access to that Ads account. Ask for access or connect a different login.",
        { internalMessage },
      );
    }
    if (codeIncludes(code, "AuthorizationError.DEVELOPER_TOKEN")) {
      return new AppError(
        "GOOGLE_ADS_API",
        "The configured Google Ads developer token cannot access this account.",
        { internalMessage },
      );
    }
    return new AppError("GOOGLE_ADS_API", "Google denied access to this Ads account.", {
      internalMessage,
    });
  }

  if (status === 404 || codeIncludes(code, "CUSTOMER_NOT_FOUND")) {
    return new AppError("GOOGLE_ADS_API", "That Google Ads customer id could not be found.", {
      internalMessage,
    });
  }

  if (status === 429 || codeIncludes(code, "QuotaError")) {
    return new AppError(
      "GOOGLE_ADS_API",
      "Google Ads is rate limiting us right now. The next sync will pick this up automatically.",
      { internalMessage },
    );
  }

  if (codeIncludes(code, "QueryError")) {
    return new AppError("GOOGLE_ADS_API", "We built an invalid report request. This has been logged.", {
      internalMessage,
    });
  }

  if (status >= 500) {
    return new AppError(
      "GOOGLE_ADS_API",
      "Google Ads is temporarily unavailable. We will retry shortly.",
      { internalMessage },
    );
  }

  return new AppError("GOOGLE_ADS_API", "Google Ads rejected the request.", {
    internalMessage,
    details: code ? { code } : undefined,
  });
}

function isRetryable(status: number, code: string | null): boolean {
  if (status === 429 || status >= 500) return true;
  return codeIncludes(code, "QuotaError") || codeIncludes(code, "InternalError");
}

export class GoogleAdsClient {
  private readonly accessToken: string;
  private readonly customerId: string;
  private readonly loginCustomerId: string | null;
  private readonly developerToken: string;
  private readonly apiVersion: string;

  constructor(options: GoogleAdsClientOptions) {
    const env = getEnv();
    if (!env.GOOGLE_ADS_DEVELOPER_TOKEN) {
      throw new AppError(
        "GOOGLE_ADS_API",
        "Google Ads is not configured on this deployment.",
        { internalMessage: "GOOGLE_ADS_DEVELOPER_TOKEN missing" },
      );
    }
    this.accessToken = options.accessToken;
    this.customerId = normalizeCustomerId(options.customerId);
    this.loginCustomerId = options.loginCustomerId
      ? normalizeCustomerId(options.loginCustomerId)
      : env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
        ? normalizeCustomerId(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)
        : null;
    this.developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN;
    this.apiVersion = env.GOOGLE_ADS_API_VERSION;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "developer-token": this.developerToken,
      "Content-Type": "application/json",
      ...(this.loginCustomerId ? { "login-customer-id": this.loginCustomerId } : {}),
    };
  }

  private url(path: string, customerId?: string): string {
    const target = customerId ? normalizeCustomerId(customerId) : this.customerId;
    return `${API_HOST}/${this.apiVersion}/customers/${target}/${path}`;
  }

  private async request<T>(
    url: string,
    body: unknown,
    context: Record<string, unknown> = {},
  ): Promise<T> {
    let lastError: AppError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          cache: "no-store",
        });
      } catch (error) {
        lastError = new AppError("GOOGLE_ADS_API", "We could not reach Google Ads.", {
          cause: error,
          internalMessage: `network failure calling ${url}`,
        });
        if (attempt < MAX_ATTEMPTS) {
          await sleep(400 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const errorBody = (await response.json().catch(() => ({}))) as GoogleAdsErrorBody;
      const code = firstErrorCode(errorBody);
      lastError = mapGoogleAdsError(response.status, errorBody);

      log.warn("google ads request failed", {
        ...context,
        status: response.status,
        code,
        attempt,
        customerId: this.customerId,
      });

      if (attempt < MAX_ATTEMPTS && isRetryable(response.status, code)) {
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new AppError("GOOGLE_ADS_API", "Google Ads request failed.");
  }

  /** Runs a GAQL query, following pagination until exhausted. */
  async search<TRow>(query: string, options: { customerId?: string; maxRows?: number } = {}): Promise<TRow[]> {
    const rows: TRow[] = [];
    const maxRows = options.maxRows ?? 200_000;
    let pageToken: string | undefined;

    do {
      const payload = await this.request<{ results?: TRow[]; nextPageToken?: string }>(
        this.url("googleAds:search", options.customerId),
        { query, pageSize: PAGE_SIZE, ...(pageToken ? { pageToken } : {}) },
        { query: query.slice(0, 120) },
      );

      if (payload.results?.length) rows.push(...payload.results);
      pageToken = payload.nextPageToken;
    } while (pageToken && rows.length < maxRows);

    return rows;
  }

  async mutate<TResponse>(
    endpoint: string,
    body: Record<string, unknown>,
    options: { customerId?: string } = {},
  ): Promise<TResponse> {
    return this.request<TResponse>(this.url(endpoint, options.customerId), body, {
      endpoint,
    });
  }

  /** listAccessibleCustomers is a GET on the customers collection, not a customer path. */
  async listAccessibleCustomerIds(): Promise<string[]> {
    const response = await fetch(`${API_HOST}/${this.apiVersion}/customers:listAccessibleCustomers`, {
      method: "GET",
      headers: this.headers(),
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as GoogleAdsErrorBody;
      throw mapGoogleAdsError(response.status, body);
    }

    const payload = (await response.json()) as { resourceNames?: string[] };
    return (payload.resourceNames ?? []).map((name) => name.split("/").pop() ?? "").filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
// Response coercion helpers — REST returns int64 as strings
// ---------------------------------------------------------------------------

export function asNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = asNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function asOptionalString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

/** "customers/123/campaigns/456" → "456" */
export function idFromResourceName(resourceName: unknown): string {
  return asString(resourceName).split("/").pop() ?? "";
}
