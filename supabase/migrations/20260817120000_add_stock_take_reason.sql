-- Widen the append-only stock ledger's reason set with the fourth reason,
-- `stock_take` — the movement an Owner-approved Stock-take Variance posts
-- (ADR-0006, amending ADR-0004). Like a correction it may go either way but
-- never zero. Nothing writes it yet: the approval slice (MP-37) ships the
-- Stock-take tables, the posting RPC, and the provenance link from a movement
-- to the count line it settles. This migration only makes the reason a
-- first-class ledger citizen so every consumer can already sum and render it.

-- The reason CHECK was created inline (auto-named <table>_<column>_check).
alter table public.stock_movements
  drop constraint stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (reason in ('sale', 'restock', 'correction', 'stock_take'));

-- Sign follows reason: restock adds, sale subtracts, correction and
-- stock_take either way — a zero Variance posts no movement at all.
alter table public.stock_movements
  drop constraint stock_movements_sign;
alter table public.stock_movements
  add constraint stock_movements_sign check (
    (reason = 'restock'    and amount > 0) or
    (reason = 'sale'       and amount < 0) or
    (reason = 'correction' and amount <> 0) or
    (reason = 'stock_take' and amount <> 0)
  );
