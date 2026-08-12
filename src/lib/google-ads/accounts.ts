import "server-only";

import { asString, GoogleAdsClient, normalizeCustomerId } from "@/lib/google-ads/client";
import { createLogger } from "@/lib/logger";
import type { AccessibleCustomer } from "@/lib/google-ads/types";

const log = createLogger("google-ads.accounts");

type CustomerRow = {
  customer?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    testAccount?: boolean;
    status?: string;
  };
};

type CustomerClientRow = {
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    manager?: boolean;
    testAccount?: boolean;
    level?: string;
    status?: string;
    clientCustomer?: string;
  };
};

const CUSTOMER_QUERY = `
  SELECT
    customer.id,
    customer.descriptive_name,
    customer.currency_code,
    customer.time_zone,
    customer.manager,
    customer.test_account,
    customer.status
  FROM customer
  LIMIT 1
`;

/** Children of a manager account, excluding the manager itself. */
const CUSTOMER_CLIENT_QUERY = `
  SELECT
    customer_client.id,
    customer_client.descriptive_name,
    customer_client.currency_code,
    customer_client.time_zone,
    customer_client.manager,
    customer_client.test_account,
    customer_client.level,
    customer_client.status,
    customer_client.client_customer
  FROM customer_client
  WHERE customer_client.status = 'ENABLED'
`;

function toAccessible(
  row: NonNullable<CustomerRow["customer"]>,
  loginCustomerId: string | null,
): AccessibleCustomer {
  return {
    customerId: asString(row.id),
    descriptiveName: row.descriptiveName?.trim() || `Account ${asString(row.id)}`,
    currencyCode: row.currencyCode ?? "EUR",
    timeZone: row.timeZone ?? "Europe/Amsterdam",
    isManager: Boolean(row.manager),
    isTestAccount: Boolean(row.testAccount),
    loginCustomerId,
    status: row.status,
  };
}

/**
 * Every Ads account the connected Google login can reach.
 *
 * `listAccessibleCustomers` only returns the top level, so each manager account is
 * expanded into its children — that is what agencies actually need to select from.
 */
export async function listAccessibleAccounts(accessToken: string): Promise<AccessibleCustomer[]> {
  const rootClient = new GoogleAdsClient({ accessToken, customerId: "0" });
  const rootIds = await rootClient.listAccessibleCustomerIds();

  const discovered = new Map<string, AccessibleCustomer>();

  for (const rootId of rootIds) {
    const client = new GoogleAdsClient({ accessToken, customerId: rootId });

    let self: AccessibleCustomer | null = null;
    try {
      const rows = await client.search<CustomerRow>(CUSTOMER_QUERY);
      const customer = rows[0]?.customer;
      if (customer) {
        self = toAccessible(customer, null);
        discovered.set(self.customerId, self);
      }
    } catch (error) {
      log.warn("could not describe accessible customer", { customerId: rootId, error });
      continue;
    }

    if (!self?.isManager) continue;

    try {
      const children = await new GoogleAdsClient({
        accessToken,
        customerId: rootId,
        loginCustomerId: rootId,
      }).search<CustomerClientRow>(CUSTOMER_CLIENT_QUERY);

      for (const child of children) {
        const row = child.customerClient;
        if (!row?.id) continue;
        const customerId = asString(row.id);
        if (customerId === self.customerId) continue;
        discovered.set(customerId, {
          customerId,
          descriptiveName: row.descriptiveName?.trim() || `Account ${customerId}`,
          currencyCode: row.currencyCode ?? "EUR",
          timeZone: row.timeZone ?? "Europe/Amsterdam",
          isManager: Boolean(row.manager),
          isTestAccount: Boolean(row.testAccount),
          loginCustomerId: rootId,
          status: row.status,
        });
      }
    } catch (error) {
      log.warn("could not expand manager account", { customerId: rootId, error });
    }
  }

  return [...discovered.values()].sort((a, b) =>
    a.descriptiveName.localeCompare(b.descriptiveName),
  );
}

export async function describeAccount(
  accessToken: string,
  customerId: string,
  loginCustomerId?: string | null,
): Promise<AccessibleCustomer | null> {
  const client = new GoogleAdsClient({
    accessToken,
    customerId: normalizeCustomerId(customerId),
    loginCustomerId,
  });
  const rows = await client.search<CustomerRow>(CUSTOMER_QUERY);
  const customer = rows[0]?.customer;
  return customer ? toAccessible(customer, loginCustomerId ?? null) : null;
}
