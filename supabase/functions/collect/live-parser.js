const DATE_LINE_PATTERN = /^[ \t]*(?:(?<year>\d{4})[ \t]*(?:[./-][ \t]*|年[ \t]*))?(?<month>\d{1,2})[ \t]*(?:[./-][ \t]*|月[ \t]*)(?<day>\d{1,2})(?:[ \t]*日?(?:[〜～~\-][ \t]*(?<endDay>\d{1,2})日?)?)?[ \t]*(?:[（(][^）)]*[）)])?[ \t]*(?<header>.*)$/gm;
const DATE_LINE_CAPTURE_PATTERN = new RegExp(DATE_LINE_PATTERN.source, "mu");
const URL_PATTERN = /https?:\/\/[^\s<>"'）)\]}]+/gi;
const URL_TEST_PATTERN = /https?:\/\//i;
const SECTION_MARKER_PATTERN = /<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

const EVENT_NAME_LABEL = /^(?:[【〖\[]\s*)?(?:イベント名|公演名|イベントタイトル|公演タイトル|event\s*name|title)(?:[】〗\]]\s*)?(?:[:：]\s*)?(.*)$/iu;
const FIELD_LABEL = /^(?:[【〖\[]\s*)?(?:イベント名|公演名|event\s*name|title|時間|日時|time|開場|開演|open|start|チケット|ticket|料金|出演|出演者|問い合わせ|お問合せ|問合せ|contact)(?:[】〗\]]\s*)?(?:[:：].*)?$/iu;
const STATUS_ONLY = /^(?:[【〖\[<＜]\s*)?(?:sold\s*out|soldout|完売|中止|公演中止|キャンセル(?:led)?)(?:\s*[】〗\]>＞])?$/iu;
const CONTROL_LINE = /^(?:詳しくは|受付(?:URL)?|URL|先行抽選|一般発売|一般販売|オフィシャル先行|チケット受付|https?:\/\/|[〈《].*[〉》])/iu;

function normalizeText(value) {
  return decodeEntities(String(value ?? ""))
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .trim();
}

function comparableText(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\u3000]+/g, "");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function getAttribute(attributes, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes ?? "").match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i")
  );
  return decodeEntities(match?.[1] ?? match?.[2] ?? "");
}

function htmlToText(html) {
  return String(html ?? "")
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attributes, inner) => {
      const href = getAttribute(attributes, "href");
      return href ? `${inner} ${href}` : inner;
    })
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(?:address|article|aside|blockquote|div|dl|dt|dd|figure|figcaption|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .join("\n");
}

function selectArtistSection(html, artistName) {
  const body = String(html ?? "");
  const target = comparableText(artistName);
  if (!target) return body;

  const markers = [...body.matchAll(SECTION_MARKER_PATTERN)]
    .map((match) => {
      const tag = match[1].toLowerCase();
      const attributes = match[2] ?? "";
      const text = normalizeText(htmlToText(match[3] ?? ""));
      const hasAnchorIdentity = tag === "a" && /\b(?:name|id)\s*=/i.test(attributes);
      const identity = comparableText(getAttribute(attributes, "name") || getAttribute(attributes, "id"));
      const isOtherAnchor = tag === "a" && /^(?:other|others|その他)$/iu.test(identity);
      const isEventDateHeading = tag.startsWith("h") && DATE_LINE_CAPTURE_PATTERN.test(text);
      return {
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        text,
        comparable: comparableText(text || identity),
        isMarker: (tag.startsWith("h") || hasAnchorIdentity) && !isEventDateHeading && (Boolean(text) || isOtherAnchor)
      };
    })
    .filter((marker) => marker.isMarker && (marker.text || marker.comparable));

  const targetIndex = markers.findIndex(
    (marker) => marker.comparable === target || marker.comparable.startsWith(`${target}・`) || marker.comparable.startsWith(`${target}-`)
  );

  if (targetIndex >= 0) {
    const start = markers[targetIndex].end;
    const end = markers.slice(targetIndex + 1).find((marker) => marker.start > start)?.start ?? body.length;
    return body.slice(start, end);
  }

  // If two or more non-date headings each own a dated schedule, this is a
  // multi-artist page. An absent target must not fall back to the whole body,
  // even when the publisher did not label the final section "Other".
  const datedSections = markers.filter((marker, index) => {
    const end = markers[index + 1]?.start ?? body.length;
    return DATE_LINE_CAPTURE_PATTERN.test(htmlToText(body.slice(marker.end, end)));
  });
  return datedSections.length >= 2 ? "" : body;
}

function parseDate(year, month, day) {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  if (
    !Number.isInteger(numericYear) ||
    !Number.isInteger(numericMonth) ||
    !Number.isInteger(numericDay) ||
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    date.getUTCFullYear() !== numericYear ||
    date.getUTCMonth() !== numericMonth - 1 ||
    date.getUTCDate() !== numericDay
  ) {
    return null;
  }
  return { year: numericYear, month: numericMonth, day: numericDay };
}

function defaultYear(source) {
  const configured = Number(source?.config?.default_year ?? source?.collector_config?.default_year);
  if (Number.isInteger(configured) && configured >= 2000 && configured <= 2100) return configured;
  return new Date().getUTCFullYear();
}

function parseDates(year, month, day, endDay, source) {
  const resolvedYear = year ? Number(year) : defaultYear(source);
  const first = parseDate(resolvedYear, month, day);
  if (!first) return [];
  const lastDay = endDay ? Number(endDay) : first.day;
  if (!Number.isInteger(lastDay) || lastDay < first.day || lastDay > 31) return [];
  const dates = [];
  for (let candidate = first.day; candidate <= lastDay; candidate += 1) {
    const date = parseDate(first.year, first.month, candidate);
    if (!date) return [];
    dates.push(date);
  }
  return dates;
}

function timezoneOffsetMinutes(source, text) {
  const value = normalizeText(text);
  if (/\bJST\b/iu.test(value)) return 9 * 60;
  const utcOffset = value.match(/\bUTC\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\b/iu);
  if (utcOffset) {
    const minutes = (Number(utcOffset[2]) * 60) + Number(utcOffset[3] ?? 0);
    return utcOffset[1] === '-' ? -minutes : minutes;
  }
  if (/\bUTC\b/iu.test(value)) return 0;
  const numericOffset = value.match(/(?:^|\s)([+-])(\d{2}):?(\d{2})(?:\s|$)/u);
  if (numericOffset) {
    const minutes = (Number(numericOffset[2]) * 60) + Number(numericOffset[3]);
    return numericOffset[1] === '-' ? -minutes : minutes;
  }
  const configured = Number(source?.config?.timezone_offset_minutes ?? source?.collector_config?.timezone_offset_minutes);
  if (Number.isInteger(configured) && configured >= -720 && configured <= 840) return configured;
  return 9 * 60;
}

function zonedIso(date, time = { hour: 0, minute: 0 }, offsetMinutes = 9 * 60) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute) - (offsetMinutes * 60_000)).toISOString();
}

function parseTime(text, labels) {
  const labelPattern = labels.join("|");
  const match = String(text ?? "").match(
    new RegExp(`(?:${labelPattern})\\s*[:：]?\\s*(\\d{1,2})(?:\\s*(?::|：|時)\\s*(\\d{1,2})\\s*分?)?`, "iu")
  );
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

function parseVenue(header) {
  const value = normalizeText(header).replace(/^[\s:：\-–—]+/, "");
  if (!value) return { venue: "", city: "" };

  const bracketMatch = value.match(/^(.*?)\s*[\[［](.+?)[\]］]\s*$/u);
  if (bracketMatch) {
    return { venue: normalizeText(bracketMatch[1]), city: normalizeText(bracketMatch[2]) };
  }

  const separatorMatch = value.match(/^(.+?)\s+(?:\/|／|[-–—])\s+([^/／–—-]+)$/u);
  if (separatorMatch) {
    return { venue: normalizeText(separatorMatch[1]), city: normalizeText(separatorMatch[2]) };
  }

  return { venue: value, city: "" };
}

function isStreamingText(value) {
  return /(?:配信|online|stream(?:ing)?|youtube|twitch|zoom)/iu.test(normalizeText(value));
}

function cleanUrl(value) {
  return String(value ?? "").replace(/[.,;:!?\]］)）}」』〉》]+$/u, "");
}

function extractUrls(text) {
  return [...String(text ?? "").matchAll(URL_PATTERN)]
    .map((match) => cleanUrl(match[0]))
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function isFieldLine(line) {
  return FIELD_LABEL.test(normalizeText(line));
}

function isControlLine(line) {
  const value = normalizeText(line);
  return STATUS_ONLY.test(value) || CONTROL_LINE.test(value) || /^(?:OPEN|START|開場|開演)\b/iu.test(value);
}

function eventNameFromLines(lines) {
  const labelIndex = lines.findIndex((line) => EVENT_NAME_LABEL.test(normalizeText(line)));
  if (labelIndex < 0) return "";

  const label = normalizeText(lines[labelIndex]);
  const match = label.match(EVENT_NAME_LABEL);
  const titleLines = [];
  if (match?.[1]) titleLines.push(match[1]);

  for (const line of lines.slice(labelIndex + 1)) {
    const value = normalizeText(line);
    if (!value || isFieldLine(value) || isControlLine(value) || URL_TEST_PATTERN.test(value)) break;
    titleLines.push(value);
  }

  return normalizeText(titleLines.join(" "));
}

function eventStatus(text) {
  const value = normalizeText(text).toLocaleLowerCase();
  if (/(?:cancelled|canceled|中止|公演中止)/iu.test(value)) return "cancelled";
  if (/(?:sold\s*out|soldout|完売)/iu.test(value)) return "sold_out";
  if (/(?:先行|presale|pre-sale)/iu.test(value)) return "presale";
  if (/(?:一般発売|一般販売|販売中|on\s*sale)/iu.test(value)) return "on_sale";
  return "announced";
}

function rawEventHash(event) {
  const value = [
    event.title,
    event.venue,
    event.city,
    event.starts_at,
    event.doors_at ?? "",
    event.ticket_url ?? "",
    event.status,
    event.source_url,
    event.notes ?? ""
  ].join("\u001f");

  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function parseEventSegment(segment, source) {
  const match = segment.match(DATE_LINE_CAPTURE_PATTERN);
  if (!match?.groups) return null;

  const dates = parseDates(match.groups.year, match.groups.month, match.groups.day, match.groups.endDay, source);
  if (!dates.length) return [];

  const header = normalizeText(match.groups.header);
  const location = parseVenue(header);

  const remaining = segment.slice(match[0].length);
  const lines = remaining.split("\n").map(normalizeText).filter(Boolean);
  const title = eventNameFromLines(lines);
  if (!title) return [];
  const streaming = isStreamingText(`${header}\n${remaining}\n${title}`);
  if (!location.venue && !streaming) return [];

  const doorsTime = parseTime(remaining, ["開場", "open"]);
  const startTime = parseTime(remaining, ["開演", "start"]);
  const offsetMinutes = timezoneOffsetMinutes(source, `${header}\n${remaining}`);
  const ticketUrls = extractUrls(remaining).filter((url) => url !== cleanUrl(source.url));
  const ticketUrl = ticketUrls[0] ?? null;
  return dates.map((date) => {
    const startsAt = zonedIso(date, startTime ?? { hour: 0, minute: 0 }, offsetMinutes);
    const doorsAt = doorsTime ? zonedIso(date, doorsTime, offsetMinutes) : null;
    const event = {
      artist_id: source.artist_id,
      source_id: source.id,
      title,
      venue: streaming && (!location.venue || /^(?:online|配信)$/iu.test(location.venue)) ? "Online / 配信" : location.venue,
      city: location.city,
      starts_at: startsAt,
      doors_at: doorsAt,
      ticket_url: ticketUrl,
      status: eventStatus(remaining),
      source_url: source.url,
      notes: ticketUrls.length > 1 ? `チケット・視聴URL: ${ticketUrls.join(" ")}` : undefined,
      raw_hash: ""
    };
    event.raw_hash = rawEventHash(event);
    return event;
  });
}

export function parseLiveEvents(source, html) {
  const selectedHtml = selectArtistSection(html, source?.artist_name ?? source?.artistName ?? "");
  if (!selectedHtml) return [];

  const text = htmlToText(selectedHtml);
  const matches = [...text.matchAll(DATE_LINE_PATTERN)];
  const events = [];

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const eventsInSegment = parseEventSegment(text.slice(start, end), source);
    events.push(...eventsInSegment);
  }

  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.title}\u001f${event.starts_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const __test__ = {
  htmlToText,
  selectArtistSection,
  parseDate,
  parseTime,
  parseVenue,
  eventStatus,
  timezoneOffsetMinutes,
  zonedIso
};
