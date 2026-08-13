import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'src/main.js',
  'src/archive-utils.js',
  'src/datetime.js',
  'src/event-period.js',
  'src/demo-data.js',
  'src/local-repository.js',
  'src/supabase-repository.js',
  'src/styles.css',
  'supabase/migrations/20260810143000_initial_artist_portal.sql',
  'supabase/migrations/20260812120000_event_collector_fields.sql',
  'supabase/migrations/20260813132726_add_collection_admin_notifications_and_archive.sql',
  'supabase/migrations/20260813143418_harden_rls_and_index_foreign_keys.sql',
  'supabase/migrations/20260813152127_enforce_stable_post_external_ids.sql',
  'supabase/migrations/20260813154226_scope_post_external_ids_by_source.sql',
  'supabase/migrations/20260813154500_claim_notification_deliveries.sql',
  'supabase/functions/collect/feed-parser.js',
  'supabase/functions/collect/article-parser.js',
  'supabase/functions/collect/youtube.js',
  'supabase/functions/collect/live-parser.js',
  'supabase/functions/collect/discord-notifier.js',
  'supabase/functions/collect/notification-retry.js',
  'supabase/functions/collect/dedupe.js',
  'supabase/functions/collect/html-snapshot.js',
  'supabase/functions/collect/source-collector.js',
  'supabase/functions/collect/index.ts',
  'tests/ui/harness.html',
  'tests/ui/harness-repository.js',
  'tests/ui/demo.html',
  'tests/sql/rls-verification.sql',
  'tests/sql/notification-claim-verification.sql'
];

for (const file of requiredFiles) {
  await access(file);
}

const html = await readFile('index.html', 'utf8');
const main = await readFile('src/main.js', 'utf8');
const collector = await readFile('supabase/functions/collect/index.ts', 'utf8');
const sourceCollector = await readFile('supabase/functions/collect/source-collector.js', 'utf8');

if (!html.includes('id="app"')) {
  throw new Error('index.html must contain #app');
}

if (!main.includes('Artist Portal')) {
  throw new Error('main.js should include the app title');
}

for (const required of ['collectSource', 'eventIdentity', 'persistEvents', 'source_url', 'doors_at', 'artists(name)', 'onConflict: "artist_id,title,starts_at"']) {
  if (!collector.includes(required)) {
    throw new Error(`collector is missing ${required}`);
  }
}

if (!sourceCollector.includes('parseLiveEvents')) {
  throw new Error('source collector is missing parseLiveEvents');
}

console.log('Static app validation passed.');
