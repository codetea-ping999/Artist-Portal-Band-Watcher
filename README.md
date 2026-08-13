# Artist Portal Band Watcher

好きなアーティストの公式サイト、SNS、ブログ、YouTube、ライブ予定を1画面で追える個人用ポータルです。

現在のアプリは **Supabase project `Artist-Portal`** に接続済みで、9mm Parabellum Bulletを初期アーティストとして登録しています。

## できること

- アーティスト一覧と公式リンク集
- ニュース、ブログ、YouTube更新の統合タイムライン
- ライブ予定のカレンダー風表示
- `.ics` 形式でライブ予定をカレンダー出力
- Supabaseの `artists` / `sources` / `posts` / `events` を読み込み
- Supabase Edge Function `collect` による情報収集
- RSS 2.0 / Atom feedの取得（URLの正規化・安定した重複排除）
- 個別ニュース/ブログ記事の取得設定、公式サイトのHTMLスナップショット差分検知
- YouTube公式Atom feedと、任意のYouTube Data APIによるサムネイル・尺・配信状態の補完
- ライブページからの複数日程、配信、公演状態、複数チケットURLの抽出
- Magic Linkログインと `curator` ロールによる管理UI
- アカウントごとに分離された曲・練習・セットリストの個人アーカイブ
- Discord更新通知（ルール・配信履歴・重複/再試行制御）
- GitHub Actionsから毎時collectorを起動するworkflow

X / Instagramは利用規約やAPI制約があるため、MVPでは自動スクレイピングせず公式リンクとして扱います。

Supabase接続時は公開データを閲覧でき、`curator` ロールのログインユーザーだけが管理UIからアーティスト、情報源、イベントを変更できます。個人アーカイブ、通知ルール、配信履歴は本人だけに表示されます。Supabase未設定時のDemo / localStorage modeでは、UIからローカルデータを編集できます。

## すぐ起動する

このMVPはビルド不要です。

```bash
python3 -m http.server 3000
```

ブラウザで開きます。

```txt
http://localhost:3000
```

`config.js` にはブラウザ公開用のSupabase Project URLとPublishable Keyのみを置いています。`service_role` / secret keyは絶対にフロントエンドへ置かないでください。

## データ構造

```txt
artists      : アーティスト基本情報
sources      : 公式サイト、RSS、YouTube、X、Instagram、ブログ、ライブ情報URL
posts        : 更新タイムライン用の記事・投稿メタデータ
events       : ライブ/配信/リリースイベント
update_logs  : collector実行ログ（非公開）
user_roles   : 管理者ロール（`curator`）
notification_rules / notification_deliveries : 本人専用の通知設定と送信履歴
personal_tracks / personal_setlists / personal_setlist_items / practice_entries : 本人専用アーカイブ
```

## Collector

`supabase/functions/collect/index.ts` が登録済みの有効なsourceを巡回します。

### 対応状況

| source | 動作 |
| --- | --- |
| `rss` | RSS / Atomの最新25件を取得し、canonical URLとコンテンツハッシュで重複排除 |
| `youtube` | チャンネルIDを解決しYouTube公式Atom feedを取得。任意のData APIキーがあれば動画メタデータも補完 |
| `official` / `label` / `blog` | 個別記事URLの設定があれば記事単位で取得し、未設定時はHTMLタイトル・descriptionの差分を保存 |
| `live` | 対象アーティストのセクションから日付・会場・都市・開場/開演・チケットURL・販売状態を抽出。既定はJSTで、明示されたJST/UTC/offsetを反映 |
| `x` / `instagram` | 自動取得せず `skipped` として記録 |

同じURLかつ同じ内容ハッシュの場合は再保存しないため、毎時実行しても不要な更新を抑えます。
イベントは `artist_id`・タイトル・開始日時の組み合わせで重複を抑えます。

YouTube Data APIは、Atom feedで取得した動画IDのうち最大25件を1回の `videos.list` 呼び出しでまとめて補完します。必要なフィールドだけを要求し、API key未設定・quota超過・HTTPエラー時は追加呼び出しを繰り返さず、その回はAtomデータをそのまま保存します。

`live` sourceは、`YYYY/M/D`・`YYYY.MM.DD`・`YYYY-MM-DD`（日本語の年月日表記も可）を含むイベント見出しを解析します。
ページ内にアーティスト見出しがある場合は対象アーティストのセクションだけを読み取り、別アーティストの予定を取り込みません。
開演時刻が取得できない公演は日本時間の00:00を `starts_at` に設定し、開場時刻は取得できた場合だけ `doors_at` に保存します。
公式ページから消えた公演は自動削除せず、`sold out`、`完売`、`中止` など明示された状態だけ更新します。

### source設定例

`sources.config` は管理UIの「設定JSON」で指定します。個別記事を取り込むときは、対象サイトに合わせてリンク範囲を明示してください。

```json
{ "article_url_prefix": "https://artist.example/news/" }
```

URLのパスで限定したい場合は `article_url_contains` も使えます。年のないライブ日程に対しては、次のように基準年を指定できます。

```json
{ "article_url_contains": "/news/" }
{ "default_year": 2026, "timezone_offset_minutes": 540 }
```

記事リンクは既定でsourceと同一originだけを許可します。公式サブドメインなど外部originの記事を意図的に許可する場合だけ、範囲ルールと合わせて `"allow_external_articles": true` を設定します。

個別ページがなく、一覧内のアンカーを記事IDとして使うサイトには次の設定を使います。初期の9mmニュース情報源はこの形式で設定済みです。

```json
{ "article_anchor_prefix": "news_", "article_container_id": "newscontents" }
```

### Edge Functionの環境変数

Supabase側には次が必要です。

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COLLECT_SHARED_SECRET
YOUTUBE_API_KEY              # 任意
DISCORD_WEBHOOK_URL          # 任意。通知を実送信するときだけ必要
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` はEdge Function環境で利用します。`COLLECT_SHARED_SECRET` は十分に長いランダム値を設定してください。

CLIでの設定例:

```bash
supabase secrets set COLLECT_SHARED_SECRET=your-long-random-value
supabase secrets set YOUTUBE_API_KEY=your-youtube-data-api-key
supabase secrets set DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

同じ値をGitHub ActionsのRepository Secret `COLLECT_SHARED_SECRET`にも登録してください。
値はリポジトリやブラウザ向け設定へ保存しないでください。

### Deploy

```bash
supabase db push
supabase functions deploy collect --no-verify-jwt
```

このFunctionは `x-collect-secret` ヘッダーを必須にする独自認証を実装しているため、未認証の公開実行を拒否します。

手動確認例:

```bash
curl -X POST \
  -H "x-collect-secret: $COLLECT_SHARED_SECRET" \
  https://gvrzchxbnnxgaysadqdd.supabase.co/functions/v1/collect
```

## 毎時自動収集

`.github/workflows/collect.yml` は毎時17分にcollectorを起動します。またGitHub Actions画面から `workflow_dispatch` で手動実行できます。

GitHub Repository Settings → Secrets and variables → Actions に、Supabase側と同じ値で次のRepository Secretを登録してください。

```txt
COLLECT_SHARED_SECRET
```

Secretが未設定の場合、workflowは安全側に倒して失敗します。

### 運用確認と一次切り分け

正常性確認は次の順で行います。

1. GitHub Actionsの `Collect artist updates` で最新のscheduled runまたは手動runが成功していることを確認する。
2. Supabase SQL Editorで次を実行し、各sourceの直近結果と診断を確認する。`update_logs` はブラウザ公開APIからは読めません。

```sql
select sources.label, update_logs.status, update_logs.message, update_logs.checked_at
from public.update_logs
join public.sources on sources.id = update_logs.source_id
order by update_logs.checked_at desc
limit 30;
```

3. `401 Unauthorized` はGitHubとSupabaseの `COLLECT_SHARED_SECRET` 不一致、`503` はSupabase側secret未設定、`5xx` はFunctionまたはDB設定を確認する。HTTP 200でもsource単位の `status: error` があり得るため、レスポンスと上記ログの両方を見る。
4. 特定sourceだけが失敗した場合は保存された短いエラーとsource URLを確認し、取得元の一時障害・HTML変更・設定JSONを切り分ける。他sourceは同じ実行内で継続処理される。
5. secretをローテーションするときはSupabase Edge Function secretを更新し、直後にGitHub Actions secretも同じ値へ更新して手動実行する。secret値や取得HTML本文をIssue・Actionsログへ貼らない。

collectorレスポンスとActionsログには件数・短い診断だけを出し、取得HTML本文、API key、Webhook URL、共有secretを出力しません。

## 管理者ログイン

1. 管理タブでメールアドレスを入力し、Magic Linkでログインします。
2. Supabase SQL Editorで、該当する `auth.users.id` に `curator` ロールを付与します。ロールの作成・変更はブラウザからできません。

```sql
insert into public.user_roles (user_id, role)
values ('<auth.users.id>', 'curator')
on conflict (user_id) do update set role = excluded.role;
```

3. 再読み込みすると、管理タブでアーティスト・情報源・イベントを追加、更新、削除できます。

## 個人アーカイブと通知

- ログイン後の「アーカイブ」タブで曲、練習記録、セットリストを作成・編集・検索・削除し、JSONエクスポートできます。RLSにより他ユーザーのデータにはアクセスできません。
- 「通知」タブで更新種別とアーティストの通知ルールを作成します。Webhook URLはデータベースに保存せず、`DISCORD_WEBHOOK_URL` secretだけから使います。
- collectorは新規投稿・新規/変更イベントを検出したときだけ送信し、同じルール/同じ内容への重複送信を防ぎます。失敗した配信は最大3回まで後続のcollector実行で再試行し、1回のcollector実行では再試行を含め最大50送信に制限します。上限超過分は `pending` として次回へ繰り越します。

## セキュリティ方針

- ブラウザにはPublishable Keyのみを置く
- `SUPABASE_SERVICE_ROLE_KEY` はEdge Function内部だけで使用する
- `update_logs` はRLSを有効にし、公開SELECT policyを作らない
- collector呼び出しには独自共有シークレットを必須にする
- 管理書き込みは `authenticated` かつ `user_roles.role = 'curator'` に限定する
- 個人データ・通知データは `auth.uid() = user_id` のRLSで分離する
- Discord WebhookやYouTube APIキーはSupabase secretにのみ置く
- SNSは非公式スクレイピングへ依存しない
- 本文全文の転載ではなく、タイトル・URL・短い要約・メタデータを保存する

## 検証

```bash
npm test
npm run validate
```

テストはRSS/Atom・個別記事・ライブ抽出・YouTube APIフォールバック・Discord送信モック・RLS方針を対象にします。

実DBの代表的な認可ケースは [tests/sql/rls-verification.sql](tests/sql/rls-verification.sql) をSupabase SQL Editorで実行します。テストは未権限ユーザー、curator、別所有者を検証し、すべてのテスト行を最後にロールバックします。
