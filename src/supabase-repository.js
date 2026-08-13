import { createLocalRepository } from './local-repository.js';
import { localDateTimeToIso } from './datetime.js';
import { makeSlug } from './utils.js';

function hasSupabaseConfig(config) {
  return Boolean(config?.supabaseUrl && config?.supabasePublishableKey);
}

async function loadSupabaseClient(config) {
  const version = config.supabaseJsVersion || '2.111.0';
  const moduleUrl = `https://esm.sh/@supabase/supabase-js@${version}`;
  const { createClient } = await import(moduleUrl);
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
}

function throwIfError(error, table) {
  if (error) throw new Error(`[Supabase:${table}] ${error.message}`);
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field}を入力してください。`);
  return normalized;
}

function optionalUrl(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${field}にはhttpまたはhttpsのURLを入力してください。`);
  }
}

function optionalJson(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return {};
  try {
    const parsed = JSON.parse(normalized);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    throw new Error(`${field}はJSONオブジェクトで入力してください。`);
  }
}

function mapArtist(input) {
  const name = requiredText(input.name, 'アーティスト名');
  return {
    name,
    slug: String(input.slug ?? '').trim() || makeSlug(name),
    genre: String(input.genre ?? '').trim() || null,
    official_url: optionalUrl(input.official_url, '公式URL'),
    description: String(input.description ?? '').trim() || null,
    status: String(input.status ?? '').trim() || 'active'
  };
}

function mapSource(input) {
  return {
    artist_id: requiredText(input.artist_id, 'アーティスト'),
    source_type: requiredText(input.source_type, 'タイプ'),
    label: requiredText(input.label, 'ラベル'),
    url: optionalUrl(requiredText(input.url, 'URL'), 'URL'),
    enabled: input.enabled !== false,
    config: typeof input.config === 'string' ? optionalJson(input.config, '収集設定') : (input.config ?? {})
  };
}

function mapEvent(input) {
  const startsAt = String(input.starts_at ?? '').trim();
  const doorsAt = String(input.doors_at ?? '').trim();
  let startsAtIso;
  let doorsAtIso;
  try {
    startsAtIso = localDateTimeToIso(startsAt);
  } catch {
    throw new Error('開始日時が正しくありません。');
  }
  try {
    doorsAtIso = localDateTimeToIso(doorsAt);
  } catch {
    throw new Error('開場日時が正しくありません。');
  }
  return {
    artist_id: requiredText(input.artist_id, 'アーティスト'),
    title: requiredText(input.title, 'イベント名'),
    venue: String(input.venue ?? '').trim() || null,
    city: String(input.city ?? '').trim() || null,
    starts_at: startsAtIso,
    doors_at: doorsAtIso,
    ticket_url: optionalUrl(input.ticket_url, 'チケットURL'),
    source_url: optionalUrl(input.source_url, '情報源URL'),
    status: String(input.status ?? '').trim() || 'announced',
    notes: String(input.notes ?? '').trim() || null
  };
}

function mapTrack(input) {
  return {
    artist_id: input.artist_id || null,
    title: requiredText(input.title, '曲名'),
    tags: String(input.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
    practice_status: String(input.practice_status ?? 'not_started'),
    notes: String(input.notes ?? '').trim()
  };
}

function mapPracticeEntry(input) {
  const duration = String(input.duration_minutes ?? '').trim();
  if (duration && (!/^\d+$/.test(duration) || Number(duration) > 1440)) throw new Error('練習時間は0〜1440分で入力してください。');
  return {
    track_id: input.track_id || null,
    practiced_on: String(input.practiced_on || new Date().toISOString().slice(0, 10)),
    duration_minutes: duration ? Number(duration) : null,
    status: String(input.status ?? 'completed'),
    notes: String(input.notes ?? '').trim()
  };
}

function mapSetlist(input) {
  return {
    event_id: input.event_id || null,
    title: requiredText(input.title, 'セットリスト名'),
    performed_on: input.performed_on || null,
    notes: String(input.notes ?? '').trim()
  };
}

function mapSetlistItem(input) {
  const position = Number(input.position);
  if (!Number.isInteger(position) || position < 1) throw new Error('曲順は1以上の整数で入力してください。');
  return {
    setlist_id: requiredText(input.setlist_id, 'セットリスト'),
    track_id: input.track_id || null,
    position,
    title: requiredText(input.title, '曲名'),
    notes: String(input.notes ?? '').trim()
  };
}

export async function createRepository(config = {}) {
  if (!hasSupabaseConfig(config)) return createLocalRepository();

  try {
    const supabase = await loadSupabaseClient(config);
    return {
      mode: 'supabase',
      readOnly: false,
      async loadAll() {
        const [artists, sources, posts, events] = await Promise.all([
          supabase.from('artists').select('*').order('created_at', { ascending: false }),
          supabase.from('sources').select('*').order('created_at', { ascending: false }),
          supabase.from('posts').select('*').order('published_at', { ascending: false }),
          supabase.from('events').select('*').order('starts_at', { ascending: true })
        ]);
        for (const [table, result] of Object.entries({ artists, sources, posts, events })) throwIfError(result.error, table);
        return {
          artists: artists.data ?? [],
          sources: sources.data ?? [],
          posts: posts.data ?? [],
          events: events.data ?? []
        };
      },
      async getSession() {
        const { data, error } = await supabase.auth.getSession();
        throwIfError(error, 'auth');
        const session = data.session;
        if (!session?.user) return { session: null, role: null };
        const { data: roleRow, error: roleError } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .maybeSingle();
        throwIfError(roleError, 'user_roles');
        return { session, role: roleRow?.role ?? null };
      },
      onAuthStateChange(callback) {
        return supabase.auth.onAuthStateChange((_event, session) => callback(session));
      },
      async sendMagicLink(email) {
        const { error } = await supabase.auth.signInWithOtp({
          email: requiredText(email, 'メールアドレス'),
          options: { emailRedirectTo: window.location.href }
        });
        throwIfError(error, 'auth');
      },
      async signOut() {
        const { error } = await supabase.auth.signOut();
        throwIfError(error, 'auth');
      },
      async addArtist(input) {
        const { data, error } = await supabase.from('artists').insert(mapArtist(input)).select().single();
        throwIfError(error, 'artists');
        return data;
      },
      async updateArtist(id, input) {
        const { data, error } = await supabase.from('artists').update(mapArtist(input)).eq('id', id).select().single();
        throwIfError(error, 'artists');
        return data;
      },
      async deleteArtist(id) {
        const { error } = await supabase.from('artists').delete().eq('id', id);
        throwIfError(error, 'artists');
      },
      async addSource(input) {
        const { data, error } = await supabase.from('sources').insert(mapSource(input)).select().single();
        throwIfError(error, 'sources');
        return data;
      },
      async updateSource(id, input) {
        const { data, error } = await supabase.from('sources').update(mapSource(input)).eq('id', id).select().single();
        throwIfError(error, 'sources');
        return data;
      },
      async deleteSource(id) {
        const { error } = await supabase.from('sources').delete().eq('id', id);
        throwIfError(error, 'sources');
      },
      async addEvent(input) {
        const { data, error } = await supabase.from('events').insert(mapEvent(input)).select().single();
        throwIfError(error, 'events');
        return data;
      },
      async updateEvent(id, input) {
        const { data, error } = await supabase.from('events').update(mapEvent(input)).eq('id', id).select().single();
        throwIfError(error, 'events');
        return data;
      },
      async deleteEvent(id) {
        const { error } = await supabase.from('events').delete().eq('id', id);
        throwIfError(error, 'events');
      },
      async loadPrivateData() {
        const [tracks, setlists, setlistItems, practiceEntries, notificationRules, deliveries] = await Promise.all([
          supabase.from('personal_tracks').select('*').order('updated_at', { ascending: false }),
          supabase.from('personal_setlists').select('*').order('performed_on', { ascending: false }),
          supabase.from('personal_setlist_items').select('*').order('position', { ascending: true }),
          supabase.from('practice_entries').select('*').order('practiced_on', { ascending: false }),
          supabase.from('notification_rules').select('*').order('created_at', { ascending: false }),
          supabase.from('notification_deliveries').select('*').order('created_at', { ascending: false }).limit(50)
        ]);
        for (const [table, result] of Object.entries({ tracks, setlists, setlistItems, practiceEntries, notificationRules, deliveries })) throwIfError(result.error, table);
        return {
          tracks: tracks.data ?? [],
          setlists: setlists.data ?? [],
          setlistItems: setlistItems.data ?? [],
          practiceEntries: practiceEntries.data ?? [],
          notificationRules: notificationRules.data ?? [],
          deliveries: deliveries.data ?? []
        };
      },
      async addTrack(input, userId) {
        const { data, error } = await supabase.from('personal_tracks').insert({
          user_id: userId,
          ...mapTrack(input)
        }).select().single();
        throwIfError(error, 'personal_tracks');
        return data;
      },
      async updateTrack(id, input) {
        const { data, error } = await supabase.from('personal_tracks').update(mapTrack(input)).eq('id', id).select().single();
        throwIfError(error, 'personal_tracks');
        return data;
      },
      async deleteTrack(id) {
        const { error } = await supabase.from('personal_tracks').delete().eq('id', id);
        throwIfError(error, 'personal_tracks');
      },
      async addPracticeEntry(input, userId) {
        const { data, error } = await supabase.from('practice_entries').insert({
          user_id: userId,
          ...mapPracticeEntry(input)
        }).select().single();
        throwIfError(error, 'practice_entries');
        return data;
      },
      async updatePracticeEntry(id, input) {
        const { data, error } = await supabase.from('practice_entries').update(mapPracticeEntry(input)).eq('id', id).select().single();
        throwIfError(error, 'practice_entries');
        return data;
      },
      async deletePracticeEntry(id) {
        const { error } = await supabase.from('practice_entries').delete().eq('id', id);
        throwIfError(error, 'practice_entries');
      },
      async addSetlist(input, userId) {
        const { data, error } = await supabase.from('personal_setlists').insert({
          user_id: userId,
          ...mapSetlist(input)
        }).select().single();
        throwIfError(error, 'personal_setlists');
        return data;
      },
      async updateSetlist(id, input) {
        const { data, error } = await supabase.from('personal_setlists').update(mapSetlist(input)).eq('id', id).select().single();
        throwIfError(error, 'personal_setlists');
        return data;
      },
      async deleteSetlist(id) {
        const { error } = await supabase.from('personal_setlists').delete().eq('id', id);
        throwIfError(error, 'personal_setlists');
      },
      async addSetlistItem(input, userId) {
        const { data, error } = await supabase.from('personal_setlist_items').insert({
          user_id: userId,
          ...mapSetlistItem(input)
        }).select().single();
        throwIfError(error, 'personal_setlist_items');
        return data;
      },
      async updateSetlistItem(id, input) {
        const { data, error } = await supabase.from('personal_setlist_items').update(mapSetlistItem(input)).eq('id', id).select().single();
        throwIfError(error, 'personal_setlist_items');
        return data;
      },
      async deleteSetlistItem(id) {
        const { error } = await supabase.from('personal_setlist_items').delete().eq('id', id);
        throwIfError(error, 'personal_setlist_items');
      },
      async addNotificationRule(input, userId) {
        const { data, error } = await supabase.from('notification_rules').insert({
          user_id: userId,
          artist_id: input.artist_id || null,
          event_type: requiredText(input.event_type, '通知種別'),
          destination_key: 'default',
          enabled: input.enabled !== false
        }).select().single();
        throwIfError(error, 'notification_rules');
        return data;
      },
      async updateNotificationRule(id, input) {
        const { data, error } = await supabase.from('notification_rules').update({ enabled: input.enabled === true }).eq('id', id).select().single();
        throwIfError(error, 'notification_rules');
        return data;
      },
      async deleteNotificationRule(id) {
        const { error } = await supabase.from('notification_rules').delete().eq('id', id);
        throwIfError(error, 'notification_rules');
      }
    };
  } catch (error) {
    console.warn('Supabase connection failed. Falling back to local demo mode.', error);
    return createLocalRepository();
  }
}
