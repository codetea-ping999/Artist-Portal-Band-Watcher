import { hashText, stripHtml } from "./feed-parser.js";

export function parseHtmlSnapshot(source, body, { now = () => new Date() } = {}) {
  const title = stripHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? source.label);
  const descriptionMatch =
    body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ??
    body.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  const description = stripHtml(descriptionMatch?.[1] ?? "公式ページの更新を確認しました。");
  const snapshotHash = hashText(`${title}:${description}`);

  return [{
    artist_id: source.artist_id,
    source_id: source.id,
    source_type: source.source_type,
    title,
    url: source.url,
    summary: description.slice(0, 320),
    external_id: source.url,
    published_at: now().toISOString(),
    raw_hash: snapshotHash
  }];
}
