export const demoArtists = [
  {
    id: '9mm-parabellum-bullet',
    name: '9mm Parabellum Bullet',
    slug: '9mm-parabellum-bullet',
    genre: 'Japanese rock',
    official_url: 'https://www.9mm.jp/index.php',
    image_url: '',
    description: '公式サイト、X、YouTube、レーベル情報、ライブ予定をまとめて追跡する初期サンプル。',
    status: 'active',
    created_at: '2026-08-10T00:00:00+09:00'
  },
  {
    id: 'sample-artist',
    name: 'Sample Artist',
    slug: 'sample-artist',
    genre: 'Demo',
    official_url: 'https://example.com',
    image_url: '',
    description: 'Supabase未接続時のUI確認用データ。',
    status: 'demo',
    created_at: '2026-08-10T00:00:00+09:00'
  }
];

export const demoSources = [
  {
    id: 'source-9mm-official',
    artist_id: '9mm-parabellum-bullet',
    source_type: 'official',
    label: 'Official Site',
    url: 'https://www.9mm.jp/index.php',
    enabled: true,
    last_checked_at: null
  },
  {
    id: 'source-9mm-x',
    artist_id: '9mm-parabellum-bullet',
    source_type: 'x',
    label: 'X / 9mm_official',
    url: 'https://x.com/9mm_official',
    enabled: true,
    last_checked_at: null
  },
  {
    id: 'source-9mm-youtube',
    artist_id: '9mm-parabellum-bullet',
    source_type: 'youtube',
    label: 'YouTube / 9mmCHANNEL',
    url: 'https://www.youtube.com/user/9mmCHANNEL',
    enabled: true,
    last_checked_at: null
  },
  {
    id: 'source-9mm-columbia',
    artist_id: '9mm-parabellum-bullet',
    source_type: 'label',
    label: '日本コロムビア',
    url: 'https://columbia.jp/artist-info/9mm/',
    enabled: true,
    last_checked_at: null
  }
];

export const demoPosts = [
  {
    id: 'post-1',
    artist_id: '9mm-parabellum-bullet',
    source_id: 'source-9mm-official',
    source_type: 'official',
    title: '公式サイトを情報源として登録',
    url: 'https://www.9mm.jp/index.php',
    summary: '公式ニュース、ライブ予定、リリース情報をここから追跡します。',
    published_at: '2026-08-10T09:00:00+09:00'
  },
  {
    id: 'post-2',
    artist_id: '9mm-parabellum-bullet',
    source_id: 'source-9mm-youtube',
    source_type: 'youtube',
    title: 'YouTubeチャンネルを登録',
    url: 'https://www.youtube.com/user/9mmCHANNEL',
    summary: 'MV、ライブ配信、公式番組の更新を一覧化する対象です。',
    published_at: '2026-08-09T19:30:00+09:00'
  },
  {
    id: 'post-3',
    artist_id: 'sample-artist',
    source_id: null,
    source_type: 'blog',
    title: 'デモ投稿: ブログ更新',
    url: 'https://example.com/blog',
    summary: 'Supabaseへ接続すると、データベース上のpostsへ置き換わります。',
    published_at: '2026-08-08T12:00:00+09:00'
  }
];

export const demoEvents = [
  {
    id: 'event-1',
    artist_id: '9mm-parabellum-bullet',
    title: 'ライブ情報ウォッチ開始',
    venue: '公式サイト / プレイガイド',
    city: 'Japan',
    starts_at: '2026-09-01T19:00:00+09:00',
    doors_at: null,
    ends_at: null,
    ticket_url: 'https://www.9mm.jp/index.php',
    source_url: 'https://www.9mm.jp/index.php',
    status: 'announced',
    notes: '実際の公演情報はSupabase収集または手動登録で置き換えてください。'
  },
  {
    id: 'event-2',
    artist_id: 'sample-artist',
    title: 'Sample Artist Demo Live',
    venue: 'Demo Hall',
    city: 'Tokyo',
    starts_at: '2026-10-05T18:30:00+09:00',
    doors_at: '2026-10-05T18:00:00+09:00',
    ends_at: null,
    ticket_url: 'https://example.com/ticket',
    source_url: 'https://example.com/live',
    status: 'on_sale',
    notes: 'カレンダー出力の動作確認用。'
  }
];
