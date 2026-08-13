export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatDateTime(value) {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function formatDate(value) {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).format(date);
}

export function daysUntil(value, nowValue = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  const now = new Date(nowValue);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return null;
  const eventDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((eventDay - today) / 86_400_000);
}

export function sortByDateDesc(items, key) {
  return [...items].sort((a, b) => new Date(b[key] ?? 0) - new Date(a[key] ?? 0));
}

export function sortByDateAsc(items, key) {
  return [...items].sort((a, b) => new Date(a[key] ?? 0) - new Date(b[key] ?? 0));
}

export function makeSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `artist-${Date.now()}`;
}

function toIcsDate(value) {
  const date = new Date(value);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldIcsLine(line) {
  if (line.length <= 72) return line;
  const chunks = [];
  let rest = line;
  while (rest.length > 72) {
    chunks.push(rest.slice(0, 72));
    rest = ` ${rest.slice(72)}`;
  }
  chunks.push(rest);
  return chunks.join('\r\n');
}

function escapeIcsText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\n', '\\n');
}

export function buildIcs(events, artists) {
  const artistById = new Map(artists.map((artist) => [artist.id, artist]));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Artist Portal Band Watcher//JP',
    'CALSCALE:GREGORIAN'
  ];

  for (const event of events) {
    if (!event.starts_at || Number.isNaN(new Date(event.starts_at).getTime())) continue;
    const artist = artistById.get(event.artist_id);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.id || crypto.randomUUID()}@artist-portal-band-watcher`);
    lines.push(`DTSTAMP:${toIcsDate(new Date().toISOString())}`);
    lines.push(`DTSTART:${toIcsDate(event.starts_at)}`);
    if (event.ends_at) lines.push(`DTEND:${toIcsDate(event.ends_at)}`);
    lines.push(`SUMMARY:${escapeIcsText(`${artist?.name ?? 'Artist'} - ${event.title}`)}`);
    lines.push(`LOCATION:${escapeIcsText([event.venue, event.city].filter(Boolean).join(' / '))}`);
    lines.push(`DESCRIPTION:${escapeIcsText([event.notes, event.ticket_url, event.source_url].filter(Boolean).join('\n'))}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n');
}

export function downloadTextFile(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
