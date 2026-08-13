import { demoArtists, demoEvents, demoPosts, demoSources } from './demo-data.js';
import { makeSlug } from './utils.js';

const STORAGE_KEY = 'artist-portal-band-watcher:v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getInitialState() {
  return {
    artists: clone(demoArtists),
    sources: clone(demoSources),
    posts: clone(demoPosts),
    events: clone(demoEvents)
  };
}

function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return getInitialState();

  try {
    const parsed = JSON.parse(raw);
    return {
      artists: Array.isArray(parsed.artists) ? parsed.artists : clone(demoArtists),
      sources: Array.isArray(parsed.sources) ? parsed.sources : clone(demoSources),
      posts: Array.isArray(parsed.posts) ? parsed.posts : clone(demoPosts),
      events: Array.isArray(parsed.events) ? parsed.events : clone(demoEvents)
    };
  } catch {
    return getInitialState();
  }
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field}を入力してください。`);
  return normalized;
}

function validUrl(value, field) {
  const normalized = requiredText(value, field);
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error(`${field}にはhttpまたはhttpsのURLを入力してください。`);
  }
  return normalized;
}

export function createLocalRepository() {
  return {
    mode: 'demo-local',
    async loadAll() {
      return readState();
    },
    async addArtist(input) {
      const state = readState();
      const name = requiredText(input.name, 'アーティスト名');
      const officialUrl = input.official_url?.trim() ? validUrl(input.official_url, '公式URL') : '';
      const artist = {
        id: crypto.randomUUID(),
        name,
        slug: makeSlug(name),
        genre: input.genre?.trim() || '未分類',
        official_url: officialUrl,
        image_url: '',
        description: input.description?.trim() || '',
        status: 'local',
        created_at: new Date().toISOString()
      };
      state.artists.unshift(artist);
      if (artist.official_url) {
        state.sources.unshift({
          id: crypto.randomUUID(),
          artist_id: artist.id,
          source_type: 'official',
          label: 'Official Site',
          url: artist.official_url,
          enabled: true,
          last_checked_at: null
        });
      }
      writeState(state);
      return artist;
    },
    async resetDemo() {
      const state = getInitialState();
      writeState(state);
      return state;
    },
    async addSource(input) {
      const state = readState();
      const artistId = requiredText(input.artist_id, 'アーティスト');
      const label = requiredText(input.label, 'ラベル');
      const url = validUrl(input.url, 'URL');
      if (!state.artists.some((artist) => artist.id === artistId)) {
        throw new Error('存在しないアーティストは選択できません。');
      }
      if (state.sources.some((source) => source.artist_id === artistId && source.url === url)) {
        throw new Error('同じアーティストに同じURLは登録できません。');
      }
      const source = {
        id: crypto.randomUUID(),
        artist_id: artistId,
        source_type: input.source_type || 'other',
        label,
        url,
        enabled: true,
        last_checked_at: null
      };
      state.sources.unshift(source);
      writeState(state);
      return source;
    },
    async deleteSource(sourceId) {
      const state = readState();
      state.sources = state.sources.filter((source) => source.id !== sourceId);
      writeState(state);
    }
  };
}
