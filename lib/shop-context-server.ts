import "server-only";

import { cookies } from "next/headers";

import { ALL_SHOPS, SHOP_SCOPE_COOKIE } from "./shop-context";

/** The raw scope cookie value, defaulting to {@link ALL_SHOPS} when unset. */
export async function readShopScope(): Promise<string> {
  const store = await cookies();
  return store.get(SHOP_SCOPE_COOKIE)?.value ?? ALL_SHOPS;
}
