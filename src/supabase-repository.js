import { createLocalRepository } from './local-repository.js';

function hasSupabaseConfig(config) {
  return Boolean(config?.supabaseUrl && config?.supabasePublishableKey);
}

async function loadSupabaseClient(config) {
  const version = config.supabaseJsVersion || '2.111.0';
  const moduleUrl = `https://esm.sh/@supabase/supabase-js@${version}`;
  const { createClient } = await import(moduleUrl);
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

function normalizeError(error, table) {
  if (!error) return null;
  return new Error(`[Supabase:${table}] ${error.message}`);
}

export async function createRepository(config = {}) {
  if (!hasSupabaseConfig(config)) {
    return createLocalRepository();
  }

  try {
    const supabase = await loadSupabaseClient(config);
    return {
      mode: 'supabase',
      async loadAll() {
        const [artists, sources, posts, events] = await Promise.all([
          supabase.from('artists').select('*').order('created_at', { ascending: false }),
          supabase.from('sources').select('*').order('created_at', { ascending: false }),
          supabase.from('posts').select('*').order('published_at', { ascending: false }),
          supabase.from('events').select('*').order('starts_at', { ascending: true })
        ]);

        for (const [table, result] of Object.entries({ artists, sources, posts, events })) {
          const error = normalizeError(result.error, table);
          if (error) throw error;
        }

        return {
          artists: artists.data ?? [],
          sources: sources.data ?? [],
          posts: posts.data ?? [],
          events: events.data ?? []
        };
      },
      readOnly: true
    };
   } catch (error) {
    console.warn('Supabase connection failed. Falling back to local demo mode.', error);
    return createLocalRepository();
  }
}
