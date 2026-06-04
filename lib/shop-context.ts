/**
 * Shop-context constants, safe to import from both Server and Client Components.
 * The Owner's active Shop context (ADR-0005) is a cookie holding either a Shop
 * id or the sentinel {@link ALL_SHOPS}; a Cashier has no context (their Shop is
 * fixed by their profile). The server-only reader lives in
 * {@link "@/lib/shop-context-server"}; the writer is `setShopScope`
 * ({@link "@/lib/actions/shell"}).
 */
export const SHOP_SCOPE_COOKIE = "mbradu_shop";
export const ALL_SHOPS = "all";
