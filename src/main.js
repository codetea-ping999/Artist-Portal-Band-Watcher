import { createRepository } from './supabase-repository.js';
import { buildArchiveExport, filterPrivateArchive } from './archive-utils.js';
import { datetimeLocalValue } from './datetime.js';
import { filterEventsByPeriod } from './event-period.js';
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
const repositoryFactory = window.ARTIST_PORTAL_REPOSITORY_FACTORY ?? createRepository;
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
  error: null,
  notice: null,
  isRefreshing: false,
  eventPeriod: 'upcoming',
  archiveQuery: '',
  editing: { artist: null, source: null, event: null, track: null, practice: null, setlist: null, setlistItem: null },
  session: null,
  role: null,
  privateData: {
    tracks: [],
    setlists: [],
    setlistItems: [],
    practiceEntries: [],
    notificationRules: [],
    deliveries: []
  }
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
  bindGlobalShortcuts();
  renderShell();
  try {
    state.repository = await repositoryFactory(config);
    state.mode = state.repository.mode;
    await refreshData();
    if (state.repository.getSession) {
      state.repository.onAuthStateChange((session) => {
        // Supabase warns against making additional auth/data calls from inside
        // the auth callback. Leave the callback synchronously, then refresh.
        setTimeout(() => {
          if (!session) {
            state.session = null;
            state.role = null;
            state.editing = { artist: null, source: null, event: null, track: null, practice: null, setlist: null, setlistItem: null };
          }
          refreshSession().catch((error) => {
            state.error = error;
            renderShell();
          });
        }, 0);
      });
      await refreshSession();
    }
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

async function refreshSession() {
  if (!state.repository?.getSession) return;
  const { session, role } = await state.repository.getSession();
  state.session = session;
  state.role = role;
  await refreshPrivateData();
  renderShell();
}

async function refreshPrivateData() {
  if (!state.session?.user || !state.repository?.loadPrivateData) {
    state.privateData = { tracks: [], setlists: [], setlistItems: [], practiceEntries: [], notificationRules: [], deliveries: [] };
    return;
  }
  state.privateData = await state.repository.loadPrivateData();
}

function canCurate() {
  return state.role === 'admin' || state.role === 'curator';
}

function artistById() {
  return new Map(state.artists.map((artist) => [artist.id, artist]));
}

function matchesSearch(values, query = state.query.trim().toLowerCase()) {
  return !query || values.some((value) => String(value ?? '').toLowerCase().includes(query));
}

function artistMatchesSearch(artist, query) {
  return matchesSearch([artist?.name, artist?.genre, artist?.description], query);
}

function filteredArtists() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.artists;
  return state.artists.filter((artist) => {
    if (artistMatchesSearch(artist, query)) return true;
    return state.sources.some((source) => source.artist_id === artist.id && matchesSearch([source.label, source.url, source.source_type, sourceLabels[source.source_type]], query))
      || state.posts.some((post) => post.artist_id === artist.id && matchesSearch([post.title, post.summary, post.source_type], query))
      || state.events.some((event) => event.artist_id === artist.id && matchesSearch([event.title, event.venue, event.city, event.status, event.notes], query));
  });
}

function filteredPosts() {
  const query = state.query.trim().toLowerCase();
  const artists = artistById();
  return sortByDateDesc(state.posts, 'published_at').filter((post) => {
    const matchArtist = state.activeArtistId === 'all' || post.artist_id === state.activeArtistId;
    const matchSearch = artistMatchesSearch(artists.get(post.artist_id), query)
      || matchesSearch([post.title, post.summary, post.source_type], query);
    return matchArtist && matchSearch;
  });
}

function filteredSources() {
  const query = state.query.trim().toLowerCase();
  const artists = artistById();
  return state.sources.filter((source) => {
    const matchArtist = state.activeArtistId === 'all' || source.artist_id === state.activeArtistId;
    const matchSearch = artistMatchesSearch(artists.get(source.artist_id), query)
      || matchesSearch([source.label, source.url, source.source_type, sourceLabels[source.source_type]], query);
    return matchArtist && matchSearch;
  });
}

function filteredEvents() {
  const query = state.query.trim().toLowerCase();
  const artists = artistById();
  return sortByDateAsc(state.events, 'starts_at').filter((event) => {
    const matchArtist = state.activeArtistId === 'all' || event.artist_id === state.activeArtistId;
    const matchSearch = artistMatchesSearch(artists.get(event.artist_id), query)
      || matchesSearch([event.title, event.venue, event.city, event.status, event.notes], query);
    return matchArtist && matchSearch;
  });
}

function upcomingEvents() {
  const now = Date.now();
  return eventsForPeriod().filter((event) => event.starts_at && new Date(event.starts_at).getTime() >= now);
}

function eventsForPeriod() {
  return filterEventsByPeriod(filteredEvents(), state.eventPeriod);
}

function captureFocusedControl() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused instanceof HTMLSelectElement)) return null;
  if (!app.contains(focused) || !focused.id) return null;
  return {
    id: focused.id,
    selectionStart: typeof focused.selectionStart === 'number' ? focused.selectionStart : null,
    selectionEnd: typeof focused.selectionEnd === 'number' ? focused.selectionEnd : null
  };
}

function restoreFocusedControl(focus) {
  if (!focus) return;
  const control = document.getElementById(focus.id);
  if (!(control instanceof HTMLElement)) return;
  control.focus({ preventScroll: true });
  if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)
    && focus.selectionStart !== null && focus.selectionEnd !== null) {
    control.setSelectionRange(focus.selectionStart, focus.selectionEnd);
  }
}

function activeFilterText() {
  const filters = [];
  if (state.activeArtistId !== 'all') {
    filters.push(artistById().get(state.activeArtistId)?.name ?? '選択中のアーティスト');
  }
  if (state.query.trim()) filters.push(`「${state.query.trim()}」`);
  return filters.join(' / ');
}

function renderFilterContext() {
  const filterText = activeFilterText();
  if (!filterText) return '';
  return `
    <div class="filter-context" role="status">
      <span><strong>絞り込み中:</strong> ${escapeHtml(filterText)}</span>
      <button class="text-button" type="button" data-action="clear-filters">クリア</button>
    </div>
  `;
}

function renderNotice() {
  if (!state.notice) return '';
  return `<div class="notice notice--${state.notice.tone}" role="status">${escapeHtml(state.notice.message)}</div>`;
}

function renderShell({ focus } = {}) {
  const focusedControl = focus ?? captureFocusedControl();
  app.innerHTML = `
    <header class="hero">
      <div class="hero__copy">
        <p class="eyebrow">Artist Portal / Band Watcher</p>
        <h1>好きなアーティストの活動を、1つのタイムラインへ。</h1>
        <p>公式サイト、SNS、ブログ、YouTube、ライブ予定を統合して、見逃しを減らす個人用ポータルです。</p>
        <div class="hero__actions">
          <button class="button button--primary" type="button" data-action="refresh" ${state.isRefreshing ? 'disabled' : ''}>${state.isRefreshing ? '更新中…' : '最新情報に更新'}</button>
          <button class="button" type="button" data-action="export-ics">ライブ予定をICS出力</button>
          ${state.mode === 'supabase' ? `<button class="button" type="button" data-action="show-tab" data-tab="admin">${state.session ? 'アカウント / 管理' : 'ログイン'}</button>` : ''}
        </div>
      </div>
      <div class="status-card">
        <span class="status-dot ${state.mode === 'supabase' ? 'status-dot--ok' : 'status-dot--demo'}"></span>
        <strong>${state.mode === 'supabase' ? 'Supabase connected' : state.mode === 'loading' ? 'Loading' : 'Demo / localStorage mode'}</strong>
        <small>${state.mode === 'supabase' ? (state.session ? `${state.session.user.email ?? 'ログイン済み'}${canCurate() ? ' / curator' : ''}` : '公開データを表示中 / ログインで個人機能を利用できます。') : 'config.local.jsを設定するとSupabaseに接続します。'}</small>
      </div>
    </header>

    <main class="layout" id="main-content" tabindex="-1">
      <aside class="sidebar">
        <div class="sidebar__filters">
          <label class="search-label" for="search">検索 <kbd>/</kbd></label>
          <input id="search" class="search" type="search" autocomplete="off" placeholder="artist, live, youtube..." value="${escapeHtml(state.query)}" aria-describedby="search-help" />
          <p class="search-help" id="search-help">名前・更新内容・情報源を横断して検索します。</p>
          <label class="search-label" for="artist-filter">アーティスト</label>
          <select id="artist-filter" class="search">
            <option value="all">すべてのアーティスト</option>
            ${state.artists.map((artist) => `<option value="${artist.id}" ${state.activeArtistId === artist.id ? 'selected' : ''}>${escapeHtml(artist.name)}</option>`).join('')}
          </select>
        </div>
       <nav class="tabs" aria-label="メインナビゲーション">
           ${tabButton('dashboard', 'ダッシュボード')}
           ${tabButton('artists', 'アーティスト')}
           ${tabButton('timeline', '更新タイムライン')}
           ${tabButton('events', 'ライブ予定')}
           ${tabButton('sources', '情報源')}
           ${state.mode === 'supabase' ? tabButton('archive', '個人アーカイブ') : ''}
           ${state.mode === 'supabase' ? tabButton('notifications', '通知') : ''}
           ${tabButton('admin', '管理')}
         </nav>
       </aside>
       <section class="content">
        ${state.error ? `<div class="notice notice--error" role="alert">${escapeHtml(state.error.message)}</div>` : ''}
        ${renderNotice()}
        ${renderFilterContext()}
        ${renderActiveTab()}
      </section>
    </main>
  `;
  bindEvents();
  restoreFocusedControl(focusedControl);
}

function tabButton(tab, label) {
  const isActive = state.activeTab === tab;
  return `<button class="tab ${isActive ? 'tab--active' : ''}" type="button" data-tab="${tab}" ${isActive ? 'aria-current="page"' : ''}>${label}</button>`;
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
    case 'archive':
      return renderArchive();
    case 'notifications':
      return renderNotifications();
     case 'sources':
       return renderSources();
     case 'admin':
       return renderAdminTab();
     default:
       return renderDashboard();
  }
}

function renderDashboard() {
  const artists = filteredArtists();
  const sources = filteredSources();
  const posts = filteredPosts();
  const events = upcomingEvents();
  const nextEvent = events[0];
  const freshPosts = posts.slice(0, 5);
  return `
    <div class="dashboard-heading">
      <div>
        <p class="eyebrow">Overview</p>
        <h2>ウォッチリストの現在地</h2>
        <p>新着情報と次の予定を優先して確認できます。</p>
      </div>
      <div class="dashboard-heading__date">${formatDate(new Date().toISOString())}</div>
    </div>
    <div class="stats-grid">
      ${statCard('アーティスト', artists.length, '表示中のアーティスト')}
      ${statCard('情報源', sources.length, '監視中の情報源')}
      ${statCard('更新', posts.length, '表示中の更新')}
      ${statCard('今後の予定', events.length, '今後の予定')}
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
    <div class="dashboard-actions" aria-label="クイックアクセス">
      <button class="quick-action" type="button" data-action="show-tab" data-tab="timeline"><span>更新をまとめて確認</span><strong>${posts.length}件</strong></button>
      <button class="quick-action" type="button" data-action="show-tab" data-tab="events"><span>ライブ予定を確認</span><strong>${events.length}件</strong></button>
    </div>
  `;
}

function statCard(label, value, caption) {
  return `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`;
}

function renderArtists() {
  const artists = filteredArtists();
  const selectedArtist = state.activeArtistId === 'all' ? null : artistById().get(state.activeArtistId);
  return `
    ${selectedArtist ? renderArtistProfile(selectedArtist) : ''}
    <section class="panel">
      <div class="section-title">
        <h2>アーティスト</h2>
        <span>${artists.length}件</span>
      </div>
      <div class="artist-grid">
        ${artists.map(renderArtistCard).join('') || emptyState('該当するアーティストがありません。')}
      </div>
    </section>
    ${state.mode === 'supabase' ? '' : `
      <section class="panel">
        <div class="section-title">
          <h2>ローカルにアーティスト追加</h2>
          <span>localStorage</span>
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
    `}
  `;
}

function renderArtistProfile(artist) {
  const posts = sortByDateDesc(state.posts.filter((post) => post.artist_id === artist.id), 'published_at').slice(0, 5);
  const events = sortByDateAsc(state.events.filter((event) => event.artist_id === artist.id), 'starts_at').filter((event) => !event.starts_at || new Date(event.starts_at).getTime() >= Date.now()).slice(0, 5);
  const sources = state.sources.filter((source) => source.artist_id === artist.id);
  return `
    <section class="panel panel--accent artist-profile">
      <div class="section-title"><div><p class="eyebrow">Artist profile</p><h2>${escapeHtml(artist.name)}</h2></div><button class="text-button" type="button" data-action="clear-artist">すべてのアーティストへ戻る</button></div>
      <p>${escapeHtml(artist.description || artist.genre || '説明未設定')}</p>
      <div class="link-row">${artist.official_url ? `<a href="${escapeHtml(artist.official_url)}" target="_blank" rel="noreferrer">公式サイト</a>` : ''}${sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.label)}</a>`).join('')}</div>
      <div class="two-column artist-profile__lists">
        <section><h3>最新の更新</h3>${posts.map(renderPostItem).join('') || emptyState('更新はまだありません。')}</section>
        <section><h3>今後の予定</h3>${events.map(renderEventItem).join('') || emptyState('今後の予定は未登録です。')}</section>
      </div>
    </section>
  `;
}

function readOnlyNotice(message) {
  return `<section class="panel"><div class="section-title"><h2>読み取り専用</h2><span>Supabase</span></div><p>${escapeHtml(message)}</p></section>`;
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
        <button class="text-button" type="button" data-select-artist="${artist.id}">このアーティストを見る</button>
      </div>
    </article>
  `;
}

function renderTimeline() {
  const posts = filteredPosts();
  return `
    <section class="panel">
      <div class="section-title">
        <div><h2>更新タイムライン</h2><p class="section-description">新しい順に、公式発表・動画・ブログ更新を一覧で確認できます。</p></div>
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
  const metadata = post.metadata && typeof post.metadata === 'object' ? post.metadata : {};
  const videoMeta = post.source_type === 'youtube' && metadata.provider === 'youtube' ? metadata : null;
  return `
    <article class="feed-item">
      <div class="feed-item__meta">
        ${renderSourceBadge(post.source_type)}
        <span>${escapeHtml(artist?.name ?? 'Unknown Artist')}</span>
        <span>${formatDateTime(post.published_at)}</span>
      </div>
      <h3><a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.title)}</a></h3>
      <p>${escapeHtml(post.summary || '要約は未設定です。')}</p>
      ${videoMeta ? `<div class="link-row">${videoMeta.thumbnail_url ? `<a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer"><img class="video-thumbnail" src="${escapeHtml(videoMeta.thumbnail_url)}" alt="" loading="lazy" /></a>` : ''}<span>${escapeHtml(videoMeta.duration || '')}${videoMeta.live_status && videoMeta.live_status !== 'none' ? ` / ${escapeHtml(videoMeta.live_status)}` : ''}${videoMeta.scheduled_start_at ? ` / 配信予定 ${escapeHtml(formatDateTime(videoMeta.scheduled_start_at))}` : ''}</span></div>` : ''}
    </article>
  `;
}

function renderEvents() {
  const events = eventsForPeriod();
  const upcoming = events.filter((event) => event.starts_at && new Date(event.starts_at).getTime() >= Date.now());
  const undated = events.filter((event) => !event.starts_at || Number.isNaN(new Date(event.starts_at).getTime()));
  const past = events.filter((event) => !upcoming.includes(event) && !undated.includes(event)).reverse();
  const icsCount = events.length - undated.length;
  return `
    <section class="panel">
      <div class="section-title">
        <div><h2>ライブ/イベント予定</h2><p class="section-description">直近の予定を上から表示します。カレンダーに書き出すこともできます。</p></div>
        <span>${events.length}件 / ICS ${icsCount}件</span>
      </div>
      <div class="period-filters" role="group" aria-label="ライブ予定の期間">
        ${[['upcoming', '以降'], ['week', '今週'], ['month', '今月'], ['all', 'すべて']].map(([value, label]) => `<button type="button" class="button ${state.eventPeriod === value ? 'button--primary' : ''}" data-action="event-period" data-period="${value}" aria-pressed="${state.eventPeriod === value}">${label}</button>`).join('')}
      </div>
      <div class="event-list">
        ${upcoming.length ? `<p class="list-label">これからの予定</p>${upcoming.map(renderEventItem).join('')}` : ''}
        ${undated.length ? `<p class="list-label">日時未定</p>${undated.map(renderEventItem).join('')}` : ''}
        ${past.length ? `<details class="past-events"><summary>終了したイベント ${past.length}件</summary><div>${past.map(renderEventItem).join('')}</div></details>` : ''}
        ${events.length ? '' : emptyState('イベントはまだありません。')}
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
        <span>${remaining === null ? '日時未定' : remaining === 0 ? '今日' : remaining === 1 ? '明日' : remaining > 1 ? `あと${remaining}日` : '終了'}</span>
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
  const sources = filteredSources();
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
            ${renderSourceBadge(source.source_type)}
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

function renderSourceBadge(sourceType) {
  const knownTypes = ['official', 'rss', 'youtube', 'x', 'instagram', 'blog', 'live', 'label'];
  const modifier = knownTypes.includes(sourceType) ? ` badge--${sourceType}` : '';
  const label = sourceLabels[sourceType] ?? sourceType ?? 'Update';
  return `<span class="badge${modifier}">${escapeHtml(label)}</span>`;
}

function privateFeatureGate(title) {
  if (state.session) return '';
  return `<section class="panel"><div class="section-title"><h2>${escapeHtml(title)}</h2><span>ログインが必要</span></div><p>個人データは公開タイムラインと分離されています。ログインしてから利用してください。</p><button class="button button--primary" type="button" data-action="show-tab" data-tab="admin">ログイン</button></section>`;
}

function renderArchive() {
  const gate = privateFeatureGate('個人アーカイブ');
  if (gate) return gate;
  const allTracks = state.privateData.tracks;
  const allSetlists = state.privateData.setlists;
  const allSetlistItems = state.privateData.setlistItems;
  const allPracticeEntries = state.privateData.practiceEntries;
  const { tracks, setlists, setlistItems, practiceEntries } = filterPrivateArchive(state.privateData, state.archiveQuery);
  const trackById = new Map(allTracks.map((track) => [track.id, track]));
  const itemsBySetlist = new Map(setlists.map((setlist) => [setlist.id, []]));
  for (const item of setlistItems) itemsBySetlist.get(item.setlist_id)?.push(item);
  const editingTrack = allTracks.find((track) => track.id === state.editing.track);
  const editingPractice = allPracticeEntries.find((entry) => entry.id === state.editing.practice);
  const editingSetlist = allSetlists.find((setlist) => setlist.id === state.editing.setlist);
  const editingSetlistItem = allSetlistItems.find((item) => item.id === state.editing.setlistItem);
  const selected = (actual, expected) => actual === expected ? 'selected' : '';
  const resultCount = (shown, total) => state.archiveQuery ? `${shown}/${total}件` : `${total}件`;
  return `
    <section class="panel"><div class="section-title"><div><h2>個人アーカイブ</h2><p class="section-description">セットリスト・練習曲・メモはログインした本人だけが閲覧・編集できます。</p></div><button class="button" type="button" data-action="export-archive">JSON出力</button></div>
      <label class="search-label" for="archive-search">アーカイブ内を検索</label><input id="archive-search" class="search" type="search" value="${escapeHtml(state.archiveQuery)}" placeholder="曲名、タグ、練習メモ、セットリスト" />
    </section>
    <div class="three-column">
      <section class="panel"><div class="section-title"><h3>練習曲</h3><span>${resultCount(tracks.length, allTracks.length)}</span></div>
        <form class="artist-form" id="track-form"><input name="title" placeholder="曲名" value="${escapeHtml(editingTrack?.title ?? '')}" required /><select name="artist_id">${artistOptions(editingTrack?.artist_id ?? '')}</select><input name="tags" placeholder="タグ（カンマ区切り）" value="${escapeHtml((editingTrack?.tags ?? []).join(', '))}" /><select name="practice_status">${['not_started','learning','rehearsing','ready','paused'].map((value) => `<option value="${value}" ${selected(editingTrack?.practice_status ?? 'not_started', value)}>${value}</option>`).join('')}</select><textarea name="notes" placeholder="個人メモ">${escapeHtml(editingTrack?.notes ?? '')}</textarea><button class="button button--primary" type="submit">${editingTrack ? '曲を更新' : '曲を追加'}</button>${editingTrack ? '<button class="text-button" type="button" data-action="cancel-private-edit" data-kind="track">キャンセル</button>' : ''}</form>
        <div class="archive-list">${tracks.map((track) => `<article class="feed-item"><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.practice_status)}</span><p>${escapeHtml((track.tags ?? []).join(', '))}</p><p>${escapeHtml(track.notes)}</p><button class="text-button" type="button" data-action="edit-private" data-kind="track" data-id="${track.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-track" data-id="${track.id}">削除</button></article>`).join('') || emptyState(state.archiveQuery ? '検索に一致する練習曲はありません。' : '練習曲はまだありません。')}</div>
      </section>
      <section class="panel"><div class="section-title"><h3>練習記録</h3><span>${resultCount(practiceEntries.length, allPracticeEntries.length)}</span></div>
        <form class="artist-form" id="practice-form"><select name="track_id"><option value="">曲を選択（任意）</option>${allTracks.map((track) => `<option value="${track.id}" ${selected(editingPractice?.track_id ?? '', track.id)}>${escapeHtml(track.title)}</option>`).join('')}</select><input name="practiced_on" type="date" value="${escapeHtml(editingPractice?.practiced_on ?? new Date().toISOString().slice(0, 10))}" /><input name="duration_minutes" type="number" min="0" max="1440" placeholder="練習時間（分）" value="${escapeHtml(editingPractice?.duration_minutes ?? '')}" /><select name="status">${['completed','planned','skipped'].map((value) => `<option value="${value}" ${selected(editingPractice?.status ?? 'completed', value)}>${value}</option>`).join('')}</select><textarea name="notes" placeholder="練習メモ">${escapeHtml(editingPractice?.notes ?? '')}</textarea><button class="button button--primary" type="submit">${editingPractice ? '記録を更新' : '記録を追加'}</button>${editingPractice ? '<button class="text-button" type="button" data-action="cancel-private-edit" data-kind="practice">キャンセル</button>' : ''}</form>
        <div class="archive-list">${practiceEntries.map((entry) => `<article class="feed-item"><strong>${escapeHtml(trackById.get(entry.track_id)?.title ?? '曲未指定')}</strong><span>${escapeHtml(entry.practiced_on)} / ${entry.duration_minutes ?? '-'}分 / ${escapeHtml(entry.status)}</span><p>${escapeHtml(entry.notes)}</p><button class="text-button" type="button" data-action="edit-private" data-kind="practice" data-id="${entry.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-practice" data-id="${entry.id}">削除</button></article>`).join('') || emptyState(state.archiveQuery ? '検索に一致する練習記録はありません。' : '練習記録はまだありません。')}</div>
      </section>
      <section class="panel"><div class="section-title"><h3>セットリスト</h3><span>${resultCount(setlists.length, allSetlists.length)}</span></div>
        <form class="artist-form" id="setlist-form"><input name="title" placeholder="セットリスト名" value="${escapeHtml(editingSetlist?.title ?? '')}" required /><select name="event_id"><option value="">公開イベントと紐付けない</option>${state.events.map((event) => `<option value="${event.id}" ${selected(editingSetlist?.event_id ?? '', event.id)}>${escapeHtml(event.title)}</option>`).join('')}</select><input name="performed_on" type="date" value="${escapeHtml(editingSetlist?.performed_on ?? '')}" /><textarea name="notes" placeholder="セットリストメモ">${escapeHtml(editingSetlist?.notes ?? '')}</textarea><button class="button button--primary" type="submit">${editingSetlist ? 'セットリストを更新' : 'セットリストを追加'}</button>${editingSetlist ? '<button class="text-button" type="button" data-action="cancel-private-edit" data-kind="setlist">キャンセル</button>' : ''}</form>
        <form class="artist-form archive-subform" id="setlist-item-form"><select name="setlist_id" required><option value="">セットリストを選択</option>${allSetlists.map((setlist) => `<option value="${setlist.id}" ${selected(editingSetlistItem?.setlist_id ?? '', setlist.id)}>${escapeHtml(setlist.title)}</option>`).join('')}</select><select name="track_id"><option value="">登録済み曲を選択（任意）</option>${allTracks.map((track) => `<option value="${track.id}" ${selected(editingSetlistItem?.track_id ?? '', track.id)}>${escapeHtml(track.title)}</option>`).join('')}</select><input name="position" type="number" min="1" placeholder="曲順" value="${escapeHtml(editingSetlistItem?.position ?? '')}" required /><input name="title" placeholder="曲名" value="${escapeHtml(editingSetlistItem?.title ?? '')}" required /><input name="notes" placeholder="メモ" value="${escapeHtml(editingSetlistItem?.notes ?? '')}" /><button class="button" type="submit">${editingSetlistItem ? '曲を更新' : '曲を追加'}</button>${editingSetlistItem ? '<button class="text-button" type="button" data-action="cancel-private-edit" data-kind="setlistItem">キャンセル</button>' : ''}</form>
        <div class="archive-list">${setlists.map((setlist) => `<article class="feed-item"><strong>${escapeHtml(setlist.title)}</strong><span>${escapeHtml(setlist.performed_on ?? '')}</span><p>${escapeHtml(setlist.notes)}</p><ol>${(itemsBySetlist.get(setlist.id) ?? []).map((item) => `<li>${escapeHtml(item.title)}${item.notes ? ` — ${escapeHtml(item.notes)}` : ''} <button class="text-button" type="button" data-action="edit-private" data-kind="setlistItem" data-id="${item.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-setlist-item" data-id="${item.id}">削除</button></li>`).join('')}</ol><button class="text-button" type="button" data-action="edit-private" data-kind="setlist" data-id="${setlist.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-setlist" data-id="${setlist.id}">セットリストを削除</button></article>`).join('') || emptyState(state.archiveQuery ? '検索に一致するセットリストはありません。' : 'セットリストはまだありません。')}</div>
      </section>
    </div>
  `;
}

function renderNotifications() {
  const gate = privateFeatureGate('通知設定');
  if (gate) return gate;
  const { notificationRules, deliveries } = state.privateData;
  const artists = artistById();
  return `
    <section class="panel"><div class="section-title"><div><h2>通知設定</h2><p class="section-description">運用者が設定した単一のDiscordチャンネル（サーバー側secret）へ新規更新・ライブ変更を通知します。利用者ごとの送信先指定はできず、Webhook URLはブラウザに保存しません。</p></div></div>
      <form class="artist-form notification-form" id="notification-rule-form"><select name="artist_id"><option value="">全アーティスト</option>${state.artists.map((artist) => `<option value="${artist.id}">${escapeHtml(artist.name)}</option>`).join('')}</select><select name="event_type"><option value="post_created">新規投稿</option><option value="event_created">新規ライブ</option><option value="event_changed">ライブ変更</option></select><button class="button button--primary" type="submit">通知ルールを追加</button></form>
      <div class="archive-list">${notificationRules.map((rule) => `<article class="feed-item"><strong>${escapeHtml(artists.get(rule.artist_id)?.name ?? '全アーティスト')} / ${escapeHtml(rule.event_type)}</strong><span>${rule.enabled ? '有効' : '無効'}</span><button class="text-button" type="button" data-action="toggle-notification" data-id="${rule.id}" data-enabled="${rule.enabled}">${rule.enabled ? '無効にする' : '有効にする'}</button> <button class="text-button danger-text" type="button" data-action="delete-notification" data-id="${rule.id}">削除</button></article>`).join('') || emptyState('通知ルールはまだありません。')}</div>
    </section>
    <section class="panel"><div class="section-title"><h3>最近の配信</h3><span>${deliveries.length}件</span></div><div class="archive-list">${deliveries.map((delivery) => `<article class="feed-item"><strong>${escapeHtml(delivery.entity_type)}</strong><span>${escapeHtml(delivery.status)} / ${delivery.attempts}回</span><p>${escapeHtml(delivery.last_error ?? '')}</p></article>`).join('') || emptyState('通知の配信履歴はまだありません。')}</div></section>
  `;
}

function emptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderAdminTab() {
  if (state.mode === 'supabase') {
    if (!state.session) {
      return `
        <section class="panel">
          <div class="section-title"><h2>ログイン</h2><span>個人機能・管理</span></div>
          <p>メールアドレスへ届くマジックリンクでログインします。公開データはログインなしで閲覧できます。</p>
          <form class="artist-form" id="magic-link-form"><input id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /><button class="button button--primary" type="submit">ログインリンクを送信</button></form>
        </section>
      `;
    }
    if (!canCurate()) {
      return `
        <section class="panel"><div class="section-title"><h2>アカウント</h2><span>${escapeHtml(state.session.user.email ?? '')}</span></div>
          <p>このアカウントは公開情報を閲覧でき、個人アーカイブと通知設定を利用できます。カタログ編集には管理者が <code>user_roles</code> に <code>curator</code> または <code>admin</code> を設定する必要があります。</p>
          <button class="button" type="button" data-action="sign-out">ログアウト</button>
        </section>
      `;
    }
    const artist = state.editing.artist ? state.artists.find((item) => item.id === state.editing.artist) : null;
    const source = state.editing.source ? state.sources.find((item) => item.id === state.editing.source) : null;
    const event = state.editing.event ? state.events.find((item) => item.id === state.editing.event) : null;
    return `
      <section class="panel"><div class="section-title"><h2>カタログ管理</h2><span>${escapeHtml(state.role)}</span></div><p>管理権限のあるアカウントだけが公開カタログを変更できます。collector設定はJSONオブジェクトで指定します。</p><button class="button" type="button" data-action="sign-out">ログアウト</button></section>
      <div class="three-column">
        <section class="panel"><div class="section-title"><h3>${artist ? 'アーティスト編集' : 'アーティスト追加'}</h3>${artist ? '<button class="text-button" type="button" data-action="cancel-edit" data-kind="artist">キャンセル</button>' : ''}</div>
          <form class="artist-form" id="catalog-artist-form"><input name="name" placeholder="アーティスト名" value="${escapeHtml(artist?.name ?? '')}" required /><input name="genre" placeholder="ジャンル" value="${escapeHtml(artist?.genre ?? '')}" /><input name="official_url" type="url" placeholder="公式URL" value="${escapeHtml(artist?.official_url ?? '')}" /><textarea name="description" placeholder="説明">${escapeHtml(artist?.description ?? '')}</textarea><button class="button button--primary" type="submit">保存</button></form>
        </section>
        <section class="panel"><div class="section-title"><h3>${source ? '情報源編集' : '情報源追加'}</h3>${source ? '<button class="text-button" type="button" data-action="cancel-edit" data-kind="source">キャンセル</button>' : ''}</div>
          <form class="artist-form" id="catalog-source-form"><select name="artist_id" required>${artistOptions(source?.artist_id)}</select><select name="source_type" required>${Object.entries(sourceLabels).map(([value, label]) => `<option value="${value}" ${source?.source_type === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select><input name="label" placeholder="表示名" value="${escapeHtml(source?.label ?? '')}" required /><input name="url" type="url" placeholder="https://..." value="${escapeHtml(source?.url ?? '')}" required /><textarea name="config" placeholder='{"article_url_prefix":"https://.../news/"}'>${escapeHtml(JSON.stringify(source?.config ?? {}, null, 2))}</textarea><label><input name="enabled" type="checkbox" ${source?.enabled !== false ? 'checked' : ''} /> 有効</label><button class="button button--primary" type="submit">保存</button></form>
        </section>
        <section class="panel"><div class="section-title"><h3>${event ? 'イベント編集' : 'イベント追加'}</h3>${event ? '<button class="text-button" type="button" data-action="cancel-edit" data-kind="event">キャンセル</button>' : ''}</div>
          <form class="artist-form" id="catalog-event-form"><select name="artist_id" required>${artistOptions(event?.artist_id)}</select><input name="title" placeholder="イベント名" value="${escapeHtml(event?.title ?? '')}" required /><input name="venue" placeholder="会場" value="${escapeHtml(event?.venue ?? '')}" /><input name="city" placeholder="都市" value="${escapeHtml(event?.city ?? '')}" /><label>開始日時<input name="starts_at" type="datetime-local" value="${datetimeLocalValue(event?.starts_at)}" /></label><label>開場日時<input name="doors_at" type="datetime-local" value="${datetimeLocalValue(event?.doors_at)}" /></label><input name="ticket_url" type="url" placeholder="チケットURL" value="${escapeHtml(event?.ticket_url ?? '')}" /><input name="source_url" type="url" placeholder="情報源URL" value="${escapeHtml(event?.source_url ?? '')}" /><select name="status">${['announced','presale','on_sale','sold_out','ended','cancelled','unknown'].map((value) => `<option value="${value}" ${event?.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select><textarea name="notes" placeholder="メモ">${escapeHtml(event?.notes ?? '')}</textarea><button class="button button--primary" type="submit">保存</button></form>
        </section>
      </div>
      <section class="panel"><div class="section-title"><h3>登録済みデータ</h3><span>編集・削除</span></div><div class="management-list">
        ${state.artists.map((item) => `<article class="source-row"><strong>${escapeHtml(item.name)}</strong><span>artist</span><div><button class="text-button" type="button" data-action="edit-catalog" data-kind="artist" data-id="${item.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-catalog" data-kind="artist" data-id="${item.id}">削除</button></div></article>`).join('')}
        ${state.sources.map((item) => `<article class="source-row"><strong>${escapeHtml(item.label)}</strong><span>source</span><div><button class="text-button" type="button" data-action="edit-catalog" data-kind="source" data-id="${item.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-catalog" data-kind="source" data-id="${item.id}">削除</button></div></article>`).join('')}
        ${state.events.map((item) => `<article class="source-row"><strong>${escapeHtml(item.title)}</strong><span>event</span><div><button class="text-button" type="button" data-action="edit-catalog" data-kind="event" data-id="${item.id}">編集</button> <button class="text-button danger-text" type="button" data-action="delete-catalog" data-kind="event" data-id="${item.id}">削除</button></div></article>`).join('')}
      </div></section>
    `;
  }
  return `
    <section class="panel">
      <div class="section-title">
        <h2>管理 (Admin)</h2>
      </div>
      <p>ローカルデモのソース（情報源）の追加・削除を行います。</p>

      <div class="two-column">
        <section class="panel">
          <div class="section-title">
            <h3>新しい情報源を追加</h3>
          </div>
          <form class="admin-form" id="source-add-form">
            <label class="search-label" for="sa-artist">アーティスト</label>
            <select name="artist_id" id="sa-artist" class="search" required>
              <option value="">選択してください</option>
              ${state.artists.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
            </select>

            <label class="search-label" for="sa-type">タイプ</label>
            <select name="source_type" id="sa-type" class="search" required>
              ${Object.entries(sourceLabels).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}
            </select>

            <label class="search-label" for="sa-label">ラベル (表示名)</label>
            <input name="label" id="sa-label" class="search" placeholder="例: 公式サイト" required />

            <label class="search-label" for="sa-url">URL</label>
            <input name="url" id="sa-url" type="url" class="search" placeholder="https://..." required />

            <button class="button button--primary" type="submit" style="margin-top: 10px;">追加</button>
          </form>
        </section>

        <section class="panel">
          <div class="section-title">
            <h3>登録済みソース一覧</h3>
          </div>
          <div class="source-table">
            ${state.sources.map(s => `
              <article class="source-row">
                <div>
                  ${renderSourceBadge(s.source_type)}
                  <strong>${escapeHtml(s.label)}</strong>
                  <br><small>${escapeHtml(state.artists.find(a => a.id === s.artist_id)?.name || 'Unknown')}</small>
                </div>
                <button class="button button--danger" type="button" data-action="delete-source" data-id="${s.id}">削除</button>
              </article>
            `).join('') || '<p>ソースはありません。</p>'}
          </div>
        </section>
      </div>

      <div style="margin-top: 20px;">
         <button class="button button--danger" type="button" data-action="reset-demo">デモデータをリセット (localStorageのみ)</button>
      </div>
    `;
}

function bindEvents() {
  const reportActionError = (error) => {
    state.error = error;
    state.notice = null;
    state.isRefreshing = false;
    renderShell();
  };
  const completeCatalogAction = async (message) => {
    await refreshData();
    state.notice = { tone: 'success', message };
    renderShell();
  };
  const completePrivateAction = async (message) => {
    await refreshPrivateData();
    state.notice = { tone: 'success', message };
    renderShell();
  };
  app.querySelector('[data-action="refresh"]')?.addEventListener('click', async () => {
    if (state.isRefreshing) return;
    state.isRefreshing = true;
    state.notice = null;
    renderShell();
    try {
      await refreshData();
      state.notice = { tone: 'success', message: '最新のデータを読み込みました。' };
    } catch (error) {
      reportActionError(error);
      return;
    }
    state.isRefreshing = false;
    renderShell();
  });
  app.querySelector('[data-action="export-ics"]')?.addEventListener('click', () => {
    const ics = buildIcs(eventsForPeriod(), state.artists);
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
  app.querySelector('[data-action="clear-filters"]')?.addEventListener('click', () => {
    state.query = '';
    state.activeArtistId = 'all';
    renderShell({ focus: { id: 'search', selectionStart: 0, selectionEnd: 0 } });
  });
  app.querySelector('[data-action="clear-artist"]')?.addEventListener('click', () => {
    state.activeArtistId = 'all';
    renderShell();
  });
  app.querySelectorAll('[data-action="event-period"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.eventPeriod = button.dataset.period;
      renderShell();
    });
  });
  app.querySelector('#archive-search')?.addEventListener('input', (event) => {
    state.archiveQuery = event.target.value;
    renderShell();
  });
  app.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderShell();
    });
  });
  app.querySelectorAll('[data-action="show-tab"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderShell();
    });
  });
  app.querySelectorAll('[data-select-artist]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeArtistId = button.dataset.selectArtist;
      state.activeTab = 'artists';
      renderShell();
    });
  });
  app.querySelector('#magic-link-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await state.repository.sendMagicLink(new FormData(event.currentTarget).get('email'));
      state.notice = { tone: 'success', message: 'ログインリンクをメールへ送信しました。' };
      renderShell();
    } catch (error) { reportActionError(error); }
  });
  app.querySelector('[data-action="sign-out"]')?.addEventListener('click', async () => {
    try {
      await state.repository.signOut();
      state.session = null;
      state.role = null;
      state.editing = { artist: null, source: null, event: null, track: null, practice: null, setlist: null, setlistItem: null };
      await refreshPrivateData();
      state.notice = { tone: 'success', message: 'ログアウトしました。' };
      renderShell();
    } catch (error) { reportActionError(error); }
  });
  app.querySelector('#catalog-artist-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.artist;
      await (updating ? state.repository.updateArtist(updating, input) : state.repository.addArtist(input));
      state.editing.artist = null;
      await completeCatalogAction(updating ? 'アーティストを更新しました。' : 'アーティストを追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelector('#catalog-source-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(event.currentTarget);
      const input = Object.fromEntries(formData.entries());
      input.enabled = formData.get('enabled') === 'on';
      const updating = state.editing.source;
      await (updating ? state.repository.updateSource(updating, input) : state.repository.addSource(input));
      state.editing.source = null;
      await completeCatalogAction(updating ? '情報源を更新しました。' : '情報源を追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelector('#catalog-event-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.event;
      await (updating ? state.repository.updateEvent(updating, input) : state.repository.addEvent(input));
      state.editing.event = null;
      await completeCatalogAction(updating ? 'イベントを更新しました。' : 'イベントを追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelectorAll('[data-action="cancel-edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editing[button.dataset.kind] = null;
      renderShell();
    });
  });
  app.querySelectorAll('[data-action="edit-catalog"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editing[button.dataset.kind] = button.dataset.id;
      renderShell();
    });
  });
  app.querySelectorAll('[data-action="delete-catalog"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const actions = { artist: state.repository.deleteArtist, source: state.repository.deleteSource, event: state.repository.deleteEvent };
      const action = actions[button.dataset.kind];
      if (!action || !confirm(`この${button.dataset.kind}を削除しますか？関連データも影響を受ける場合があります。`)) return;
      try {
        await action.call(state.repository, button.dataset.id);
        await completeCatalogAction(`${button.dataset.kind}を削除しました。`);
      } catch (error) { reportActionError(error); }
    });
  });
  app.querySelector('#artist-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    try {
      const artist = await state.repository.addArtist(Object.fromEntries(formData.entries()));
      state.activeTab = 'artists';
      state.notice = { tone: 'success', message: `${artist.name}をウォッチリストに追加しました。` };
      await refreshData();
    } catch (error) {
      reportActionError(error);
    }
  });
  app.querySelectorAll('[data-action="delete-source"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.dataset.id;
      if (confirm('このソースを削除しますか？')) {
        try {
          await state.repository.deleteSource(id);
          state.notice = { tone: 'success', message: '情報源を削除しました。' };
          await refreshData();
        } catch (error) {
          reportActionError(error);
        }
      }
    });
  });

  app.querySelector('#source-add-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const input = Object.fromEntries(formData.entries());
    try {
      const source = await state.repository.addSource(input);
      state.notice = { tone: 'success', message: `${source.label}を情報源に追加しました。` };
      await refreshData();
    } catch (error) {
      reportActionError(error);
    }
  });

  app.querySelector('#track-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.track;
      await (updating ? state.repository.updateTrack(updating, input) : state.repository.addTrack(input, state.session.user.id));
      state.editing.track = null;
      await completePrivateAction(updating ? '練習曲を更新しました。' : '練習曲を追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelectorAll('[data-action="delete-track"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('この練習曲を削除しますか？関連する練習記録・セットリスト項目は残り、曲との紐付けだけが解除されます。')) return;
      try { await state.repository.deleteTrack(button.dataset.id); if (state.editing.track === button.dataset.id) state.editing.track = null; await completePrivateAction('練習曲を削除しました。'); } catch (error) { reportActionError(error); }
    });
  });
  app.querySelector('#practice-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.practice;
      await (updating ? state.repository.updatePracticeEntry(updating, input) : state.repository.addPracticeEntry(input, state.session.user.id));
      state.editing.practice = null;
      await completePrivateAction(updating ? '練習記録を更新しました。' : '練習記録を追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelectorAll('[data-action="delete-practice"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('この練習記録を削除しますか？')) return;
      try { await state.repository.deletePracticeEntry(button.dataset.id); if (state.editing.practice === button.dataset.id) state.editing.practice = null; await completePrivateAction('練習記録を削除しました。'); } catch (error) { reportActionError(error); }
    });
  });
  app.querySelector('#setlist-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.setlist;
      await (updating ? state.repository.updateSetlist(updating, input) : state.repository.addSetlist(input, state.session.user.id));
      state.editing.setlist = null;
      await completePrivateAction(updating ? 'セットリストを更新しました。' : 'セットリストを追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelector('#setlist-item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(event.currentTarget).entries());
      const updating = state.editing.setlistItem;
      await (updating ? state.repository.updateSetlistItem(updating, input) : state.repository.addSetlistItem(input, state.session.user.id));
      state.editing.setlistItem = null;
      await completePrivateAction(updating ? 'セットリストの曲を更新しました。' : 'セットリストに曲を追加しました。');
    } catch (error) { reportActionError(error); }
  });
  app.querySelectorAll('[data-action="edit-private"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editing[button.dataset.kind] = button.dataset.id;
      renderShell();
    });
  });
  app.querySelectorAll('[data-action="cancel-private-edit"]').forEach((button) => {
    button.addEventListener('click', () => {
      state.editing[button.dataset.kind] = null;
      renderShell();
    });
  });
  app.querySelectorAll('[data-action="delete-setlist"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('このセットリストと曲順を削除しますか？')) return;
      try { await state.repository.deleteSetlist(button.dataset.id); if (state.editing.setlist === button.dataset.id) state.editing.setlist = null; state.editing.setlistItem = null; await completePrivateAction('セットリストを削除しました。'); } catch (error) { reportActionError(error); }
    });
  });
  app.querySelectorAll('[data-action="delete-setlist-item"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('この曲をセットリストから削除しますか？')) return;
      try { await state.repository.deleteSetlistItem(button.dataset.id); if (state.editing.setlistItem === button.dataset.id) state.editing.setlistItem = null; await completePrivateAction('曲を削除しました。'); } catch (error) { reportActionError(error); }
    });
  });
  app.querySelector('[data-action="export-archive"]')?.addEventListener('click', () => {
    downloadTextFile('artist-portal-private-archive.json', JSON.stringify(buildArchiveExport(state.privateData), null, 2), 'application/json');
  });
  app.querySelector('#notification-rule-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await state.repository.addNotificationRule(Object.fromEntries(new FormData(event.currentTarget).entries()), state.session.user.id); await completePrivateAction('通知ルールを追加しました。'); } catch (error) { reportActionError(error); }
  });
  app.querySelectorAll('[data-action="toggle-notification"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try { await state.repository.updateNotificationRule(button.dataset.id, { enabled: button.dataset.enabled !== 'true' }); await completePrivateAction('通知ルールを更新しました。'); } catch (error) { reportActionError(error); }
    });
  });
  app.querySelectorAll('[data-action="delete-notification"]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('この通知ルールを削除しますか？')) return;
      try { await state.repository.deleteNotificationRule(button.dataset.id); await completePrivateAction('通知ルールを削除しました。'); } catch (error) { reportActionError(error); }
    });
  });

  app.querySelector('[data-action="reset-demo"]')?.addEventListener('click', async () => {
    if (confirm('デモデータをリセットしますか？（保存されている変更は消えます）')) {
      try {
        await state.repository.resetDemo();
        state.notice = { tone: 'success', message: 'デモデータを初期状態に戻しました。' };
        await refreshData();
      } catch (error) {
        reportActionError(error);
      }
    }
  });
}

function artistOptions(selectedId = '') {
  return `<option value="">アーティストを選択</option>${state.artists.map((artist) => `<option value="${artist.id}" ${artist.id === selectedId ? 'selected' : ''}>${escapeHtml(artist.name)}</option>`).join('')}`;
}

function bindGlobalShortcuts() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (event.key === '/' && !isEditing) {
      event.preventDefault();
      document.querySelector('#search')?.focus();
    }
    if (event.key === 'Escape' && target instanceof HTMLInputElement && target.id === 'search' && state.query) {
      state.query = '';
      renderShell({ focus: { id: 'search', selectionStart: 0, selectionEnd: 0 } });
    }
  });
}

boot();
