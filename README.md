# Artist Portal Band Watcher

好きなアーティストの公式サイト、SNS、ブログ、YouTube、ライブ予定を1画面で追える個人用ポータルです。

## できること

- アーティスト一覧と公式リンク集
- ニュース、SNS、ブログ、YouTube更新の統合タイムライン
- ライブ予定のカレンダー風表示
- `.ics` 形式でライブ予定をカレンダー出力
- Supabaseに接続して `artists` / `sources` / `posts` / `events` を読み込み
- Supabase未設定時はデモデータ + localStorageで動作
- Supabase Edge Function `collect` によるRSS/公式サイト更新収集の土台

## すぐ起動する

このMVPはビルド不要です。

```bash
python3 -m http.server 3000
```

ブラウザで開きます。

```txt
http://localhost:3000
```

## Supabaseに接続する

1. Supabaseプロジェクトを作成します。
2. `supabase/migrations/20260810143000_initial_artist_portal.sql` をSQL Editorで実行します。
3. `supabase/seed.sql` を実行して初期データを入れます。
4. `config.example.js` を `config.local.js` にコピーします。
5. `config.local.js` にProject URLとPublishable Keyを設定します。

```js
window.ARTIST_PORTAL_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "sb_publishable_xxx"
};
```

> `config.local.js` は `.gitignore` 済みです。service role keyは絶対にフロントエンドへ置かないでください。

## データ構造

```txt
artists  : アーティスト基本情報
sources  : 公式サイト、RSS、YouTube、X、Instagram、ブログ、ライブ情報URL
posts    : 更新タイムライン用の記事・投稿メタデータ
events   : ライブ/配信/リリースイベント
update_logs : 収集処理の結果ログ
```

## Edge Functionの使い方

`supabase/functions/collect/index.ts` は、登録済みsourceを巡回してRSSやHTMLタイトルを `posts` に取り込むための初期実装です。

必要な環境変数:

```txt
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

デプロイ例:

```bash
supabase functions deploy collect --no-verify-jwt
```

公開Webhookにする場合は、`COLLECT_SHARED_SECRET` のような独自シークレット検証を追加してください。

## 今後の拡張候補

- YouTube Data API連携
- X API / Instagram Graph APIは公式APIまたは埋め込み中心で対応
- 管理者ログインと編集UI
- GitHub ActionsまたはSupabase Cronで定期収集
- Next.js版への移行
- セットリスト/練習曲/楽曲メモの個人アーカイブ
