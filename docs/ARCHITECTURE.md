# Architecture

## Goal

Artist Portal Band Watcherは、好きなアーティストの一次情報をまとめて確認するための個人用ポータルです。

## MVP Scope

```txt
Browser static app
  ├─ Demo/localStorage repository
  ├─ Optional Supabase repository
  ├─ Timeline renderer
  ├─ Event renderer
  └─ ICS exporter

Supabase
  ├─ artists
  ├─ sources
  ├─ posts
  ├─ events
  ├─ update_logs
  └─ collect Edge Function
```

## Design Principles

1. **公式/一次情報を優先する**  
   ライブ予定、チケット、リリース情報は公式サイト・レーベル・プレイガイドなど一次情報を優先します。

2. **SNSスクレイピングに依存しない**  
   X、Instagram、TikTokはAPIや利用規約が変わりやすいため、MVPでは公式リンク・埋め込み・手動登録を中心にします。

3. **全文転載しない**  
   保存するのはタイトル、URL、日時、短い要約、取得元メタデータに限定します。

4. **Service Role Keyをフロントに出さない**  
   収集処理はEdge Functionやサーバー側で行います。ブラウザ側はPublishable Keyのみを使います。

## Next Steps

### Admin UI

- Supabase Authを追加
- curator/adminロール設計
- artists/sources/events編集フォーム
- RLSをユーザー所有または管理者ロールに合わせて拡張

### Collectors

- RSS collectorの精度向上
- YouTube Data API collector
- 公式サイトHTML差分検知
- イベント抽出用LLM/ルールベースparser
- GitHub Actions or Supabase Cronで定期実行

### Product UX

- アーティスト別ページ
- 今週/今月のライブ表示
- 通知対象ルール
- Discord Webhook / Gmail通知
- セットリスト、練習曲、楽曲メモの個人アーカイブ
