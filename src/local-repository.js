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

export function createLocalRepository() {
  return {
    mode: 'demo-local',
    async loadAll() {
      return readState();
    },
    async addArtist(input) {
      const state = readState();
      const artist = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        slug: makeSlug(input.name),
        genre: input.genre?.trim() || '未分類',
        official_url: input.official_url?.trim() || '',
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
    }
  };
}
