const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "mc_cid", "mc_eid"]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hashText(value) {
  let hash = 0;
  for (const character of String(value ?? "")) {
    hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(16);
}

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

export function stripHtml(value) {
  return decodeEntities(String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeUrl(base, maybeUrl) {
  try {
    const baseUrl = new URL(String(base ?? ""));
    if (!['http:', 'https:'].includes(baseUrl.protocol)) return "";
    const url = new URL(String(maybeUrl ?? ""), base);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return "";
  }
}

export function getTag(block, tag) {
  const escaped = escapeRegExp(tag);
  const match = String(block ?? "").match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

export function getTagAttribute(block, tag, attribute) {
  const escapedTag = escapeRegExp(tag);
  const escapedAttribute = escapeRegExp(attribute);
  const match = String(block ?? "").match(
    new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttribute}=["']([^"']+)["'][^>]*>`, "i")
  );
  return match ? decodeEntities(match[1]).trim() : "";
}

function getLinks(block) {
  const links = [];
  const pattern = /<(?:[\w-]+:)?link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?link>)/gi;
  for (const match of String(block ?? "").matchAll(pattern)) {
    const attributes = match[1] ?? "";
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const rel = attributes.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? "";
    const text = stripHtml(match[2] ?? "");
    if (href || text) links.push({ href: decodeEntities(href), rel, type, text });
  }
  return links;
}

function preferredLink(source, block) {
  const links = getLinks(block);
  const ranked = [
    ...links.filter((link) => link.rel === "alternate" && link.href),
    ...links.filter((link) => !link.rel && link.href),
    ...links.filter((link) => link.href && !link.type.includes("xml")),
    ...links.filter((link) => link.href),
    ...links.filter((link) => link.text)
  ];
  for (const candidate of ranked) {
    const safeUrl = canonicalizeUrl(source.url, candidate.href || candidate.text);
    if (safeUrl) return safeUrl;
  }
  return "";
}

function parsedDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstTag(block, tags) {
  for (const tag of tags) {
    const value = getTag(block, tag);
    if (value) return value;
  }
  return "";
}

export function feedPost(source, block, kind) {
  const title = stripHtml(getTag(block, "title") || source.label || "Untitled update");
  const url = preferredLink(source, block);
  if (!url) return null;
  const summary = stripHtml(firstTag(block, ["description", "content:encoded", "media:description", "summary", "content"]))
    .slice(0, 320);
  const publishedValue = firstTag(block, ["pubDate", "published", "updated", "dc:date"]);
  const publishedAt = parsedDate(publishedValue);
  const externalId = firstTag(block, ["guid", "id", "yt:videoId"]) || url;

  return {
    artist_id: source.artist_id,
    source_id: source.id,
    source_type: source.source_type,
    title,
    url,
    summary,
    external_id: externalId,
    published_at: publishedAt,
    raw_hash: hashText(`${kind}:${externalId}:${title}:${summary}:${publishedAt ?? ""}`)
  };
}

function deduplicate(posts) {
  const byIdentity = new Map();
  for (const post of posts) {
    const key = `${post.external_id || ""}:${post.url}`;
    if (!byIdentity.has(key)) byIdentity.set(key, post);
  }
  return [...byIdentity.values()];
}

export function parseFeed(source, body) {
  const document = String(body ?? "");
  const rssDocument = /<rss\b/i.test(document) && /<\/rss>/i.test(document) && /<channel\b/i.test(document);
  const atomDocument = /<(?:[\w-]+:)?feed\b/i.test(document) && /<\/(?:[\w-]+:)?feed>/i.test(document);
  if (!rssDocument && !atomDocument) {
    throw new Error("Response is not a valid RSS or Atom feed.");
  }

  if (rssDocument) {
    const rssItems = [...document.matchAll(/<(?:[\w-]+:)?item\b[\s\S]*?<\/(?:[\w-]+:)?item>/gi)].map((match) => match[0]);
    return deduplicate(rssItems.slice(0, 25).map((block) => feedPost(source, block, "rss")).filter(Boolean));
  }

  const atomEntries = [...document.matchAll(/<(?:[\w-]+:)?entry\b[\s\S]*?<\/(?:[\w-]+:)?entry>/gi)].map((match) => match[0]);
  return deduplicate(atomEntries.slice(0, 25).map((block) => feedPost(source, block, "atom")).filter(Boolean));
}
