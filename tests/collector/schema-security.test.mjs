import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(new URL("../../supabase/migrations/20260813132726_add_collection_admin_notifications_and_archive.sql", import.meta.url), "utf8");
const hardening = await readFile(new URL("../../supabase/migrations/20260813143418_harden_rls_and_index_foreign_keys.sql", import.meta.url), "utf8");
const notificationClaims = await readFile(new URL("../../supabase/migrations/20260813154500_claim_notification_deliveries.sql", import.meta.url), "utf8");

test("keeps archive and notification tables behind owner-scoped RLS", () => {
  for (const table of ["notification_rules", "notification_deliveries", "personal_tracks", "personal_setlists", "personal_setlist_items", "practice_entries"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/i);
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata/i);
});

test("does not expose update logs or callable security-definer functions", () => {
  assert.match(hardening, /on public\.update_logs for all\s+to service_role/i);
  assert.match(hardening, /revoke all on function public\.rls_auto_enable\(\) from public, anon, authenticated/i);
});

test("claims notification delivery rows atomically and exposes the RPC only to service_role", () => {
  assert.match(notificationClaims, /unique index if not exists notification_rules_user_scope_unique/i);
  assert.match(notificationClaims, /update public\.notification_deliveries[\s\S]+status in \('pending', 'failed'\)[\s\S]+returning delivery\.\*/i);
  assert.match(notificationClaims, /revoke all on function public\.claim_notification_delivery\(uuid\) from public, anon, authenticated/i);
  assert.match(notificationClaims, /grant execute on function public\.claim_notification_delivery\(uuid\) to service_role/i);
  assert.doesNotMatch(notificationClaims, /security definer/i);
});
