-- Drop the legacy 4-arg complete_sale overload (ADR-0008, follow-up to #27).
--
-- 20261112120000_idempotent_complete_sale.sql added the idempotent 6-arg
-- complete_sale(p_sale_id, p_shop_id, p_customer, p_lines, p_payments,
-- p_expected_total) and deliberately kept the old 4-arg overload alive so the
-- app deployed at the time could keep selling. Everything now on main calls the
-- 6-arg version (Sell screen + integration tests), so the old overload is dead
-- weight — and a non-idempotent path that could still double-book a Sale if
-- anything ever called it again.
--
-- APPLY ONLY AFTER production is confirmed running the new Sell screen (#28+);
-- an older deployed build calling the 4-arg signature would fail to sell.
--
-- Only the exact legacy signature is dropped; the 6-arg function is untouched.

drop function if exists public.complete_sale(uuid, text, jsonb, jsonb);
