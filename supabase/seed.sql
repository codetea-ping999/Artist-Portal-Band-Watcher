-- Starter data for Artist Portal Band Watcher

with artist as (
  insert into public.artists (name, slug, genre, official_url, description)
  values (
    '9mm Parabellum Bullet',
    '9mm-parabellum-bullet',
    'Japanese rock',
    'https://www.9mm.jp/index.php',
    '公式サイト、X、YouTube、レーベル情報、ライブ予定をまとめて追跡する初期サンプル。'
  )
  on conflict (slug) do update set
    official_url = excluded.official_url,
    description = excluded.description
  returning id
), source_rows as (
  insert into public.sources (artist_id, source_type, label, url)
  select id, source_type::public.source_type, label, url
  from artist,
  (values
    ('official', 'Official Site', 'https://www.9mm.jp/index.php'),
    ('live', 'Official Live Schedule', 'https://www.9mm.jp/live.php'),
    ('x', 'X / 9mm_official', 'https://x.com/9mm_official'),
    ('youtube', 'YouTube / 9mmCHANNEL', 'https://www.youtube.com/user/9mmCHANNEL'),
    ('label', '日本コロムビア', 'https://columbia.jp/artist-info/9mm/')
  ) as data(source_type, label, url)
  on conflict (artist_id, url) do update set
    label = excluded.label,
    source_type = excluded.source_type,
    enabled = true
  returning id, artist_id, source_type, label, url
)
insert into public.posts (artist_id, source_id, source_type, title, url, summary, published_at)
select artist_id, id, source_type, title, url, summary, published_at::timestamptz
from source_rows
join (values
  ('Official Site', '公式サイトを情報源として登録', '公式ニュース、ライブ予定、リリース情報をここから追跡します。', '2026-08-10T09:00:00+09:00'),
  ('YouTube / 9mmCHANNEL', 'YouTubeチャンネルを登録', 'MV、ライブ配信、公式番組の更新を一覧化する対象です。', '2026-08-09T19:30:00+09:00'),
  ('日本コロムビア', 'レーベル公式ページを登録', 'リリース、メディア掲載、配信情報を確認する対象です。', '2026-08-08T12:00:00+09:00')
) as post_seed(label, title, summary, published_at) using (label)
on conflict (artist_id, url) do nothing;

insert into public.events (artist_id, title, venue, city, starts_at, ticket_url, source_url, status, notes)
select id,
  'ライブ情報ウォッチ開始',
  '公式サイト / プレイガイド',
  'Japan',
  '2026-09-01T19:00:00+09:00',
  official_url,
  official_url,
  'announced',
  '実際の公演情報は手動登録またはcollectorで置き換えてください。'
from public.artists
where slug = '9mm-parabellum-bullet'
on conflict (artist_id, title, starts_at) do nothing;
