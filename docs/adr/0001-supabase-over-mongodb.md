# Supabase (Postgres + Auth) for data and authentication

We use Supabase — Postgres for data and Supabase Auth for accounts — as the backend for the POS, even though this repo ships with MongoDB MCP tooling that would have made MongoDB the path of least resistance.

We chose Supabase because the domain is relational and money-touching (Items, Sales, Line items, Payments, Stock movements with summed-quantity invariants), and because Supabase bundles auth, row-level security, and Postgres transactions — which we lean on for atomic stock decrements and for owner-only visibility of cost/margin. The cost is real lock-in to Supabase's auth and RLS model.

## Considered Options

- **MongoDB** (tooling already present): rejected — the data is relational and we want transactional stock updates and SQL aggregation for the dashboard.
- **Supabase**: chosen.
