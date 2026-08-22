# ReelAI Analytics

A standalone, private owner website for ReelAI/Nosca product analytics. This is a
separate application and deployment: it is not an `/analytics` route in the web
app and it is not part of the marketing landing page.

> **Deployment gate:** a prior Railway diagnostic exposed the existing product
> service environments. Do not deploy this dashboard with any credential from
> that exposed set. Rotate the affected product secrets first, redeploy and verify
> their dependents, prove the old values no longer authenticate, and issue a fresh
> column-restricted `analytics_reader` credential for this site.

The dashboard covers retained-database growth, product journey signals,
engagement, generation-pipeline health, provider usage, tracked OpenAI cost
exposure, subscription plan value, source mix, and learner levels. It never
returns account-level rows, email addresses, usernames, raw materials, or search
text to the browser.

## Trust boundary

```text
browser -> standalone password login -> signed HttpOnly cookie
        -> Next.js server -> read-only Railway PostgreSQL role
```

- PostgreSQL is accessed only from server code.
- Every analytics read uses one repeatable-read, read-only transaction.
- Queries use parameterized date bounds and a 20-second statement timeout.
- API responses are private/no-store and the entire site is noindex/nofollow.
- The app runs no migrations, creates no indexes, and performs no database writes.
- The login is independent of ReelAI product-account sessions.

Noindex is not an access control. Keep the standalone password long and unique,
rotate it and the session secret when an operator leaves, and consider placing the
deployment behind an identity-aware access proxy as an additional layer.

## Configure

Copy `.env.example` to `.env.local` and set:

- `ANALYTICS_DATABASE_URL`: a Railway PostgreSQL URL for a dedicated read-only
  role. Do not use a `NEXT_PUBLIC_` variable.
- `ANALYTICS_PASSWORD`: a unique password of at least 16 characters.
- `ANALYTICS_SESSION_SECRET`: at least 32 random characters. Generate one with
  `openssl rand -base64 48`.
- `ANALYTICS_TRUSTED_PROXY_HOPS`: required in production. Set the exact number of
  sanitizing reverse-proxy hops represented at the right of `X-Forwarded-For`.
  Verify that contract with the hosting platform; a wrong value can weaken or
  over-broaden login throttling. Keep `0` only for local development.
- `ANALYTICS_PUBLIC_ORIGIN`: the canonical public HTTPS origin of this standalone
  site, with no path (for example, `https://analytics.example.com`). Login and
  logout compare browser `Origin` against this value rather than an internal
  proxy URL.
- `BILLING_ENTITLEMENT_ENVIRONMENT`: `Production` for live Stripe rows or
  `Sandbox` for test rows.
- `NEXT_PUBLIC_PRODUCT_URL`: optional external link back to the product.

The read-only PostgreSQL role should have `CONNECT` on the database, `USAGE` on
the `public` schema, and column-level `SELECT` only on the fields queried here:

```sql
GRANT SELECT (id, created_at) ON community_accounts TO analytics_reader;
GRANT SELECT (account_id, plan_code, status, current_period_end, provider,
  provider_environment) ON billing_subscriptions TO analytics_reader;
GRANT SELECT (account_id, usage_day, used_count) ON daily_search_usage TO analytics_reader;
GRANT SELECT (account_id, usage_day, status) ON search_quota_reservations TO analytics_reader;
GRANT SELECT (inventory_state, released_at) ON reels TO analytics_reader;
GRANT SELECT (learner_id, created_at, watched_to_end_at) ON learner_reel_progress TO analytics_reader;
GRANT SELECT (helpful, confusing, mastery_updated_at) ON reel_feedback TO analytics_reader;
GRANT SELECT (is_correct, created_at) ON assessment_attempts TO analytics_reader;
GRANT SELECT (status, created_at, started_at, completed_at, terminal_error_code)
  ON reel_generation_jobs TO analytics_reader;
GRANT SELECT (state) ON retrieval_source_inventory TO analytics_reader;
GRANT SELECT (provider, operation, billable_requests, input_tokens, output_tokens,
  total_tokens, created_at) ON generation_provider_usage TO analytics_reader;
GRANT SELECT (state, settled_microusd, unknown_microusd, reserved_microusd,
  settled_at) ON material_openai_cost_ledger TO analytics_reader;
GRANT SELECT (source_type, knowledge_level, created_at) ON materials TO analytics_reader;
```

Do not also grant table-level `SELECT`: it would expose sensitive columns the
dashboard never uses. A private-schema view layer exposing the same columns is an
even stronger alternative. Give the role no `INSERT`, `UPDATE`, `DELETE`,
`CREATE`, ownership, superuser, role-management, replication, or RLS-bypass
privileges. Setting
`default_transaction_read_only=on` and a role-level statement timeout provides a
second database-side guard.

Before pointing the site at a growing production database, review and apply
[`database/recommended-indexes.sql`](database/recommended-indexes.sql) through the
product database's normal migration/operations process. The analytics credential
cannot run it. The indexes are deliberately not created by this app and should be
built one at a time during a low-traffic window.

## Run locally

```sh
npm install
npm run dev
```

For visual QA without a database, set `ANALYTICS_DEMO_MODE=1` in development.
That preview mode is ignored in production.

## Verify

```sh
npm run check
```

This runs unit/security contracts, TypeScript checking, and a production build.
Before the first live release, also smoke-test the 7/30/90-day views against a
read-only PostgreSQL credential and confirm the role cannot write or create DDL.

## Deploy as its own website

Railway is the simplest topology when the product database already lives there:

1. Create a new service from this repository in the same Railway project.
2. Give it its own generated/custom domain.
3. Use `npm ci && npm run build` as the build command and `npm start` as the start
   command.
4. Add the environment variables above. Prefer Railway's private PostgreSQL URL
   for the read-only role.
5. Use `/login` for a lightweight HTTP health check, then verify the root route
   redirects there when signed out.

The built-in login backoff is process-local. Keep a single application replica or
add a distributed edge/WAF rate limit; multi-replica deployments must not treat
the in-process limiter as their only brute-force control. The login and logout
routes also require same-origin POSTs.

Vercel can host the separate deployment, but it needs Railway's public or pooled
TLS URL plus a distributed edge/WAF or identity-aware proxy login limit. Cold
starts and multiple instances make the built-in process-local backoff insufficient
on their own. Keep the database pool small and never expose its URL to the client.

## Interpret the metrics carefully

- Selected windows are UTC calendar days; the current day is partial.
- Historical cleanup can remove generation records, so the dashboard describes
  retained data rather than immutable lifetime history.
- The journey is a signal ladder, not a strict funnel or cohort-retention model.
- Consumed searches subtract still-open quota reservations.
- Active subscription list value is not recognized revenue or collected cash.
- Supadata dollar cost is not stored; provider request counts are shown instead.
- Pipeline timing samples at most the latest 10,000 in-window jobs.
- Source work counts only current pending and leased inventory; it does not rescan
  lifetime completed-source history.
