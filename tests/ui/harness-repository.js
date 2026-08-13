const now = '2026-08-14T00:00:00.000Z';

const catalog = {
  artists: [
    { id: 'artist-a', name: 'QA Artist', slug: 'qa-artist', genre: 'Rock', official_url: 'https://example.test/artist', description: '管理画面と閲覧導線のQA用', status: 'active', created_at: now }
  ],
  sources: [
    { id: 'source-a', artist_id: 'artist-a', source_type: 'official', label: 'QA Official', url: 'https://example.test/news', enabled: true, config: {}, created_at: now }
  ],
  posts: [
    { id: 'post-a', artist_id: 'artist-a', source_id: 'source-a', source_type: 'youtube', title: 'QA Live Stream', url: 'https://youtube.example/watch/a', summary: '短い要約だけを表示します。', published_at: '2026-08-13T12:00:00.000Z', metadata: { duration: 'PT4M12S', live_broadcast_content: 'upcoming', thumbnail_url: 'https://example.test/thumb.jpg' } }
  ],
  events: [
    { id: 'event-upcoming', artist_id: 'artist-a', title: 'Tomorrow Live', venue: 'QA Hall', city: 'Tokyo', starts_at: '2026-08-15T10:00:00.000Z', doors_at: '2026-08-15T09:30:00.000Z', ticket_url: 'https://example.test/ticket', source_url: 'https://example.test/live', status: 'on_sale', notes: '' },
    { id: 'event-tbd', artist_id: 'artist-a', title: 'Date TBD Event', venue: 'TBD', city: '', starts_at: null, doors_at: null, ticket_url: null, source_url: 'https://example.test/tbd', status: 'unknown', notes: '日時未定' },
    { id: 'event-cancelled', artist_id: 'artist-a', title: 'Cancelled Event', venue: 'QA Hall', city: 'Tokyo', starts_at: '2026-08-20T10:00:00.000Z', doors_at: null, ticket_url: null, source_url: 'https://example.test/cancelled', status: 'cancelled', notes: '中止' },
    { id: 'event-ended', artist_id: 'artist-a', title: 'Ended Event', venue: 'Old Hall', city: 'Tokyo', starts_at: '2026-08-01T10:00:00.000Z', doors_at: null, ticket_url: null, source_url: 'https://example.test/ended', status: 'ended', notes: '終了' }
  ]
};

const privateData = {
  tracks: [{ id: 'track-a', user_id: 'qa-user', artist_id: 'artist-a', title: 'QA Song', tags: ['riff'], practice_status: 'learning', notes: '個人メモ' }],
  practiceEntries: [{ id: 'practice-a', user_id: 'qa-user', track_id: 'track-a', practiced_on: '2026-08-14', duration_minutes: 30, status: 'completed', notes: 'メトロノーム練習' }],
  setlists: [{ id: 'setlist-a', user_id: 'qa-user', event_id: 'event-upcoming', title: 'QA Setlist', performed_on: '2026-08-15', notes: '本番用' }],
  setlistItems: [{ id: 'item-a', user_id: 'qa-user', setlist_id: 'setlist-a', track_id: 'track-a', position: 1, title: 'QA Song', notes: '' }],
  notificationRules: [{ id: 'rule-a', user_id: 'qa-user', artist_id: 'artist-a', event_type: 'post_created', destination_key: 'default', enabled: true }],
  deliveries: [{ id: 'delivery-a', rule_id: 'rule-a', entity_type: 'post', entity_id: 'post-a', status: 'sent', attempts: 1, last_error: null }]
};

let nextId = 1;
const clone = (value) => structuredClone(value);
const add = (rows, prefix, input) => {
  const row = { id: `${prefix}-${nextId++}`, ...clone(input) };
  rows.push(row);
  return clone(row);
};
const update = (rows, id, input) => {
  const row = rows.find((item) => item.id === id);
  if (!row) throw new Error(`QA row not found: ${id}`);
  Object.assign(row, clone(input));
  return clone(row);
};
const remove = (rows, id) => {
  const index = rows.findIndex((item) => item.id === id);
  if (index >= 0) rows.splice(index, 1);
};
const trackInput = (input) => ({
  ...clone(input),
  artist_id: input.artist_id || null,
  tags: Array.isArray(input.tags) ? input.tags : String(input.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean)
});

export async function createQaRepository() {
  return {
    mode: 'supabase',
    readOnly: false,
    async loadAll() { return clone(catalog); },
    async getSession() { return { session: { user: { id: 'qa-user', email: 'qa@example.test' } }, role: 'curator' }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() {},
    async sendMagicLink() {},
    async addArtist(input) { return add(catalog.artists, 'artist', input); },
    async updateArtist(id, input) { return update(catalog.artists, id, input); },
    async deleteArtist(id) { remove(catalog.artists, id); },
    async addSource(input) { return add(catalog.sources, 'source', input); },
    async updateSource(id, input) { return update(catalog.sources, id, input); },
    async deleteSource(id) { remove(catalog.sources, id); },
    async addEvent(input) { return add(catalog.events, 'event', input); },
    async updateEvent(id, input) { return update(catalog.events, id, input); },
    async deleteEvent(id) { remove(catalog.events, id); },
    async loadPrivateData() { return clone(privateData); },
    async addTrack(input, userId) { return add(privateData.tracks, 'track', { user_id: userId, ...trackInput(input) }); },
    async updateTrack(id, input) { return update(privateData.tracks, id, trackInput(input)); },
    async deleteTrack(id) { remove(privateData.tracks, id); },
    async addPracticeEntry(input, userId) { return add(privateData.practiceEntries, 'practice', { user_id: userId, ...input }); },
    async updatePracticeEntry(id, input) { return update(privateData.practiceEntries, id, input); },
    async deletePracticeEntry(id) { remove(privateData.practiceEntries, id); },
    async addSetlist(input, userId) { return add(privateData.setlists, 'setlist', { user_id: userId, ...input }); },
    async updateSetlist(id, input) { return update(privateData.setlists, id, input); },
    async deleteSetlist(id) { remove(privateData.setlists, id); },
    async addSetlistItem(input, userId) { return add(privateData.setlistItems, 'item', { user_id: userId, ...input }); },
    async updateSetlistItem(id, input) { return update(privateData.setlistItems, id, input); },
    async deleteSetlistItem(id) { remove(privateData.setlistItems, id); },
    async addNotificationRule(input, userId) { return add(privateData.notificationRules, 'rule', { user_id: userId, destination_key: 'default', enabled: true, ...input }); },
    async updateNotificationRule(id, input) { return update(privateData.notificationRules, id, input); },
    async deleteNotificationRule(id) { remove(privateData.notificationRules, id); }
  };
}
