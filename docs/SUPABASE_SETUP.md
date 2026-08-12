# Supabase setup checklist

This repository already includes the schema, seed data, and collector Edge Function.
What remains for the live Supabase project is to create the remote project and apply
the existing database/function assets.

The browser application is intentionally read-only in Supabase mode. Use the SQL
Editor for initial data and source maintenance until an authenticated admin flow is
introduced. The localStorage demo mode is separate and can be edited from the UI.

## Required setup

1. Create a new Supabase project.
2. Open the SQL editor and apply:
   - `supabase/migrations/20260810143000_initial_artist_portal.sql`
   - `supabase/migrations/20260812120000_event_collector_fields.sql`
3. Seed starter data with:
   - `supabase/seed.sql`
4. Copy `config.example.js` to `config.local.js`.
5. Set the project URL and publishable key in `config.local.js`.
6. Deploy the collector Edge Function:
   - `supabase functions deploy collect --no-verify-jwt`
7. Add a shared secret for the collector, then store it in the function environment:
   - `COLLECT_SHARED_SECRET`
   - CLI example: `supabase secrets set COLLECT_SHARED_SECRET=your-long-random-value`

Keep the same value in the GitHub Actions repository secret named `COLLECT_SHARED_SECRET`.
Do not commit the value or place it in `config.js`, `config.local.js`, or any browser-facing file.

The starter seed includes the official live schedule as a `live` source. The collector
extracts events from the matching artist section and stores dates in Japan Standard
Time. It supports common slash, dot, hyphen, and Japanese date formats, venue/city
brackets, opening and starting times, ticket links, and explicit sale states such as
presale, on sale, sold out, and cancelled. Missing starting times are stored as
midnight JST. Events that disappear from a page are retained rather than deleted.

## Safety notes

- Do not place the `service_role` key in browser-facing config.
- `update_logs` stays private by design.
- Keep the browser app read-only until an authenticated admin flow is added.

## Suggested environment variables for the collector

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COLLECT_SHARED_SECRET` (recommended)

## Verification

After setup, the app should:

- connect in Supabase mode when `config.local.js` is present and valid
- show artists, sources, posts, and events from the remote database
- show live events collected from the seeded `live` source with ticket links and status when available
- hide/disable browser editing controls in Supabase mode
- continue to fall back to demo/localStorage mode when Supabase config is missing
