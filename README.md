# Artist Portal Band Watcher

好きなアーティストの公式サイト、SNS、ブログ、YouTube、ライブ予定を1画面で追える個人用ポータルです。

現在のMVPは **Supabase project `Artist-Portal`** に接続済みで、9mm Parabellum Bulletを初期アーティストとして登録しています。

## できること

- アーティスト一覧と公式リンク集
- ニュース、ブログ、YouTube更新の統合タイムライン
- ライブ予定のカレンダー風表示
- `.ics` 形式でライブ予定をカレンダー出力
- Supabaseの `artists` / `sources` / `posts` / `events` を読み込み
- Supabase Edge Function `collect` による情報収集
- RSS 2.0 / Atom feedの取得
- YouTubeチャンネルから公式Atom feedを解決して新着動画を取得
- 公式サイト/レーベルページのHTMLスナップショット差分検知
- GitHub Actionsから毎時collectorを起動するworkflow

X / Instagramは利用規約やAPI制約があるため、MVPでは自動スクレイピングせず公式リンクとして扱います。

Supabase接続時のブラウザアプリは読み取り専用です。アーティストや情報源の追加・削除はSQL Editorで行い、公開キーによる書き込みは発生しません。Supabase未設定時のDemo / localStorage modeでは、UIからローカルデータを編集できます。

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
```

## Collector

`supabase/functions/collect/index.ts` が登録済みの有効なsourceを巡回します。

### 対応状況

| source | 動作 |
| --- | --- |
| `rss` | RSS / Atomの最新25件を取得 |
| `youtube` | チャンネルIDを解決しYouTube公式Atom feedを取得 |
| `official` / `label` / `blog` | HTMLタイトル・descriptionの差分を保存 |
| `live` | HTMLから検出した日付・会場をeventsへ保存 |
| `x` / `instagram` | 自動取得せず `skipped` として記録 |

同じURLかつ同じ内容ハッシュの場合は再保存しないため、毎時実行しても不要な更新を抑えます。
イベントは `artist_id`・タイトル・開始日時の組み合わせで重複を抑えます。

### Edge Functionの環境変数

Supabase側には次が必要です。

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
COLLECT_SHARED_SECRET
```

`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` はEdge Function環境で利用します。`COLLECT_SHARED_SECRET` は十分に長いランダム値を設定してください。

### Deploy

```bash
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

## セキュリティ方針

- ブラウザにはPublishable Keyのみを置く
- `SUPABASE_SERVICE_ROLE_KEY` はEdge Function内部だけで使用する
- `update_logs` はRLSを有効にし、公開SELECT policyを作らない
- collector呼び出しには独自共有シークレットを必須にする
- SNSは非公式スクレイピングへ依存しない
- 本文全文の転載ではなく、タイトル・URL・短い要約・メタデータを保存する

## 次の拡張

- 公式サイトのニュース一覧を個別記事単位で抽出
- ライブページから日付・会場・開場/開演・チケットURLを `events` へ抽出
- YouTube Data APIを使ったメタデータ強化
- 管理者ログインと編集UI
- Discord / メール等の重要更新通知
- セットリスト、練習曲、楽曲メモの個人アーカイブ
