import { createRepository } from './supabase-repository.js';
import {
  buildIcs,
  daysUntil,
  downloadTextFile,
  escapeHtml,
  formatDate,
  formatDateTime,
  sortByDateAsc,
  sortByDateDesc
} from './utils.js';

const app = document.querySelector('#app');
const config = window.ARTIST_PORTAL_CONFIG ?? {};
const state = {
  repository: null,
  mode: 'loading',
  artists: [],
  sources: [],
  posts: [],
  events: [],
  query: '',
  activeTab: 'dashboard',
  activeArtistId: 'all',
  error: null
};

const sourceLabels = {
  official: '公式',
  rss: 'RSS',
  youtube: 'YouTube',
  x: 'X',
  instagram: 'Instagram',
  blog: 'Blog',
  live: 'Live',
  label: 'Label',
  other: 'Other'
};

async function boot() {
  renderShell();
  try {
    state.repository = await createRepository(config);
    state.mode = state.repository.mode;
    await refreshData();
  } catch (error) {
    state.error = error;
    renderShell();
  }
}

async function refreshData() {
  const data = await state.repository.loadAll();
  state.artists = data.artists;
  state.sources = data.sources;
  state.posts = data.posts;
  state.events = data.events;
  state.error = null;
  renderShell();
}

function artistById() {
  return new Map(state.artists.map((artist) => [artist.id, artist]));
}

function filteredArtists() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.artists;
  return state.artists.filter((artist) => {
    return [artist.name, artist.genre, artist.description].some((value) => String(value ?? '').toLowerCase().includes(query));
  });
}

function filteredPosts() {
  const artistIds = new Set(filteredArtists().map((artist) => artist.id));
  return sortByDateDesc(state.posts, 'published_at').filter((post) => {
    const matchArtist = state.activeArtistId === 'all' || post.artist_id === state.activeArtistId;
    const matchSearch = !state.query || [post.title, post.summary, post.source_type].some((value) => String(value ?? '').toLowerCase().includes(state.query.toLowerCase()));
    return artistIds.has(post.artist_id) && matchArtist && matchSearch;
  });
}

function filteredEvents() {
  const artistIds = new Set(filteredArtists().map((artist) => artist.id));
  return sortByDateAsc(state.events, 'starts_at').filter((event) => {
    const matchArtist = state.activeArtistId === 'all' || event.artist_id === state.activeArtistId;
    const matchSearch = !state.query || [event.title, event.venue, event.city, event.status].some((value) => String(value ?? '').toLowerCase().includes(state.query.toLowerCase()));
    return artistIds.has(event.artist_id) && matchArtist && matchSearch;
  });
}

function upcomingEvents() {
  const now = Date.now();
  return filteredEvents().filter((event) => event.starts_at && new Date(event.starts_at).getTime() >= now);
}

function renderShell() {
  app.innerHTML = `
    <header class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Artist Portal / Band Watcher</p>
        <h1>好きなアーティストの活動を、1つのタイムラインへ。</h1>
        <p>公式サイト、SNS、ブログ、YouTube、ライブ予定を統合して、見逃しを減らす個人用ポータルです。</p>
        <div class="hero__actions">
          <button class="button button--primary" data-action="refresh">更新</button>
          <button class="button" data-action="export-ics">ライブ予定をICS出力</button>
        </div>
      </div>
      <div class="status-card">
        <span class="status-dot ${state.mode === 'supabase' ? 'status-dot--ok' : 'status-dot--demo'}"></span>
        <strong>${state.mode === 'supabase' ? 'Supabase connected' : state.mode === 'loading' ? 'Loading' : 'Demo / localStorage mode'}</strong>
        <small>${state.mode === 'supabase' ? 'Database tables are powering this view.' : 'config.local.jsを設定するとSupabaseに接続します。'}</small>
      </div>
    </header>

    <main class="layout">
      <aside class="sidebar">
        <label class="search-label" for="search">検索</label>
        <input id="search" class="search" type="search" placeholder="artist, live, youtube..." value="${escapeHtml(state.query)}" />
        <label class="search-label" for="artist-filter">アーティスト</label>
        <select id="artist-filter" class="search">
          <option value="all">すべて</option>
          ${state.artists.map((artist) => `<option value="${artist.id}" ${state.activeArtistId === artist.id ? 'selected' : ''}>${escapeHtml(artist.name)}</option>`).join('')}
        </select>
        <nav class="tabs" aria-label="Main navigation">
          ${tabButton('dashboard', 'ダッシュボード')}
          ${tabButton('artists', 'アーティスト')}
          ${tabButton('timeline', '更新タイムライン')}
          ${tabButton('events', 'ライブ予定')}
          ${tabButton('sources', '情報源')}
        </nav>
      </aside>
      <section class="content">
        ${state.error ? `<div class="notice notice--error">${escapeHtml(state.error.message)}</div>` : ''}
        ${renderActiveTab()}
      </section>
    </main>
  `;
  bindEvents();
}

function tabButton(tab, label) {
  return `<button class="tab ${state.activeTab === tab ? 'tab--active' : ''}" data-tab="${tab}">${label}</button>`;
}

function renderActiveTab() {
  if (state.mode === 'loading') return '<div class="panel"><h2>読み込み中...</h2></div>';
  switch (state.activeTab) {
    case 'artists':
      return renderArtists();
    case 'timeline':
      return renderTimeline();
    case 'events':
      return renderEvents();
    case 'sources':
      return renderSources();
    default:
      return renderDashboard();
  }
}

function renderDashboard() {
  const posts = filteredPosts();
  const events = upcomingEvents();
  const nextEvent = events[0];
  const freshPosts = posts.slice(0, 5);
  return `
    <div class="stats-grid">
      ${statCard('Artists', state.artists.length, '登録アーティスト')}
      ${statCard('Sources', state.sources.length, '監視対象')}
      ${statCard('Updates', state.posts.length, '取得済み更新')}
      ${statCard('Upcoming', events.length, '今後の予定')}
    </div>
    <div class="two-column">
      <section class="panel">
        <div class="section-title">
          <h2>今日見るべき更新</h2>
          <span>${freshPosts.length}件</span>
        </div>
        ${freshPosts.map(renderPostItem).join('') || emptyState('まだ更新がありません。')}
      </section>
      <section class="panel panel--accent">
        <div class="section-title">
          <h2>次のライブ/イベント</h2>
          <span>${nextEvent ? formatDate(nextEvent.starts_at) : '未定'}</span>
        </div>
        ${nextEvent ? renderEventItem(nextEvent) : emptyState('今後の予定は未登録です。')}
      </section>
    </div>
  `;
}

function statCard(label, value, caption) {
  return `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`;
}

function renderArtists() {
  const artists = filteredArtists();
  return `
    <section class="panel">
      <div class="section-title">
        <h2>アーティスト</h2>
        <span>${artists.length}件</span>
      </div>
      <div class="artist-grid">
        ${artists.map(renderArtistCard).join('') || emptyState('該当するアーティストがありません。')}
      </div>
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>ローカルにアーティスト追加</h2>
        <span>${state.mode === 'supabase' ? 'read-only MVP' : 'localStorage'}</span>
      </div>
      <form class="artist-form" id="artist-form">
        <input name="name" placeholder="アーティスト名" required />
        <input name="genre" placeholder="ジャンル / メモ" />
        <input name="official_url" type="url" placeholder="公式URL" />
        <textarea name="description" placeholder="推しポイント / 追跡方針"></textarea>
        <button class="button button--primary" type="submit">追加</button>
        <button class="button" type="button" data-action="reset-demo">デモに戻す</button>
      </form>
    </section>
  `;
}

function renderArtistCard(artist) {
  const sources = state.sources.filter((source) => source.artist_id === artist.id);
  const posts = state.posts.filter((post) => post.artist_id === artist.id);
  const events = state.events.filter((event) => event.artist_id === artist.id);
  const initials = artist.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return `
    <article class="artist-card">
      <div class="artist-card__avatar">${escapeHtml(initials)}</div>
      <div>
        <h3>${escapeHtml(artist.name)}</h3>
        <p>${escapeHtml(artist.description || artist.genre || '説明未設定')}</p>
      </div>
      <div class="mini-metrics">
        <span>${sources.length} sources</span>
        <span>${posts.length} updates</span>
        <span>${events.length} events</span>
      </div>
      <div class="link-row">
        ${artist.official_url ? `<a href="${escapeHtml(artist.official_url)}" target="_blank" rel="noreferrer">公式サイト</a>` : ''}
        <button class="text-button" data-select-artist="${artist.id}">このアーティストを見る</button>
      </div>
    </article>
  `;
}

function renderTimeline() {
  const posts = filteredPosts();
  return `
    <section class="panel">
      <div class="section-title">
        <h2>更新タイムライン</h2>
        <span>${posts.length}件</span>
      </div>
      <div class="timeline">
        ${posts.map(renderPostItem).join('') || emptyState('更新はまだありません。')}
      </div>
    </section>
  `;
}

function renderPostItem(post) {
  const artist = artistById().get(post.artist_id);
  const label = sourceLabels[post.source_type] ?? post.source_type ?? 'Update';
  return `
    <article class="feed-item">
      <div class="feed-item__meta">
        <span class="badge">${escapeHtml(label)}</span>
        <span>${escapeHtml(artist?.name ?? 'Unknown Artist')}</span>
        <span>${formatDateTime(post.published_at)}</span>
      </div>
      <h3><a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.title)}</a></h3>
      <p>${escapeHtml(post.summary || '要約は未設定です。')}</p>
    </article>
  `;
}

function renderEvents() {
  const events = filteredEvents();
  return `
    <section class="panel">
      <div class="section-title">
        <h2>ライブ/イベント予定</h2>
        <span>${events.length}件</span>
      </div>
      <div class="event-list">
        ${events.map(renderEventItem).join('') || emptyState('イベントはまだありません。')}
      </div>
    </section>
  `;
}

function renderEventItem(event) {
  const artist = artistById().get(event.artist_id);
  const remaining = daysUntil(event.starts_at);
  return `
    <article class="event-item">
      <div class="event-date">
        <strong>${formatDate(event.starts_at)}</strong>
        <span>${remaining === null ? '未定' : remaining >= 0 ? `あと${remaining}日` : `${Math.abs(remaining)}日前`}</span>
      </div>
      <div class="event-body">
        <div class="feed-item__meta">
          <span class="badge badge--event">${escapeHtml(event.status || 'event')}</span>
          <span>${escapeHtml(artist?.name ?? 'Unknown Artist')}</span>
        </div>
        <h3>${escapeHtml(event.title)}</h3>
        <p>${escapeHtml([event.venue, event.city].filter(Boolean).join(' / ') || '会場未設定')}</p>
        ${event.notes ? `<p>${escapeHtml(event.notes)}</p>` : ''}
        <div class="link-row">
          ${event.ticket_url ? `<a href="${escapeHtml(event.ticket_url)}" target="_blank" rel="noreferrer">チケット</a>` : ''}
          ${event.source_url ? `<a href="${escapeHtml(event.source_url)}" target="_blank" rel="noreferrer">情報源</a>` : ''}
        </div>
      </div>
    </article>
  `;
}

function renderSources() {
  const sources = state.sources.filter((source) => state.activeArtistId === 'all' || source.artist_id === state.activeArtistId);
  const artists = artistById();
  return `
    <section class="panel">
      <div class="section-title">
        <h2>情報源</h2>
        <span>${sources.length}件</span>
      </div>
      <div class="source-table">
        ${sources.map((source) => `
          <article class="source-row">
            <span class="badge">${escapeHtml(sourceLabels[source.source_type] ?? source.source_type)}</span>
            <strong>${escapeHtml(source.label)}</strong>
            <span>${escapeHtml(artists.get(source.artist_id)?.name ?? 'Unknown')}</span>
            <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">開く</a>
            <small>${source.enabled ? 'enabled' : 'disabled'} / checked: ${source.last_checked_at ? formatDateTime(source.last_checked_at) : 'never'}</small>
          </article>
        `).join('') || emptyState('情報源はまだありません。')}
      </div>
    </section>
  `;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function bindEvents() {
  app.querySelector('[data-action="refresh"]')?.addEventListener('click', async () => {
    await refreshData();
  });
  app.querySelector('[data-action="export-ics"]')?.addEventListener('click', () => {
    const ics = buildIcs(upcomingEvents(), state.artists);
    downloadTextFile('artist-events.ics', ics, 'text/calendar');
  });
  app.querySelector('#search')?.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderShell();
  });
  app.querySelector('#artist-filter')?.addEventListener('change', (event) => {
    state.activeArtistId = event.target.value;
    renderShell();
  });
  app.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderShell();
    });
  });
  app.querySelectorAll('[data-select-artist]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeArtistId = button.dataset.selectArtist;
      state.activeTab = 'timeline';
      renderShell();
    });
  });
  app.querySelector('#artist-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      await state.repository.addArtist(Object.fromEntries(formData.entries()));
      await refreshData();
      state.activeTab = 'artists';
    } catch (error) {
      alert(error.message);
    }
  });
  app.querySelector('[data-action="reset-demo"]')?.addEventListener('click', async () => {
    try {
      await state.repository.resetDemo();
      await refreshData();
    } catch (error) {
      alert(error.message);
    }
  });
}

boot();
