function includesQuery(values, query) {
  return values.some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
}

export function filterPrivateArchive(data, rawQuery) {
  const query = String(rawQuery ?? '').trim().toLocaleLowerCase();
  const tracks = data.tracks ?? [];
  const setlists = data.setlists ?? [];
  const setlistItems = data.setlistItems ?? [];
  const practiceEntries = data.practiceEntries ?? [];
  if (!query) return { tracks, setlists, setlistItems, practiceEntries };

  const trackById = new Map(tracks.map((track) => [track.id, track]));
  const itemsBySetlist = new Map(setlists.map((setlist) => [setlist.id, []]));
  for (const item of setlistItems) itemsBySetlist.get(item.setlist_id)?.push(item);

  const filteredTracks = tracks.filter((track) => includesQuery([
    track.title,
    ...(track.tags ?? []),
    track.practice_status,
    track.notes
  ], query));
  const filteredPracticeEntries = practiceEntries.filter((entry) => includesQuery([
    entry.practiced_on,
    entry.status,
    entry.duration_minutes,
    entry.notes,
    trackById.get(entry.track_id)?.title
  ], query));
  const filteredSetlists = setlists.filter((setlist) => includesQuery([
    setlist.title,
    setlist.performed_on,
    setlist.notes,
    ...(itemsBySetlist.get(setlist.id) ?? []).flatMap((item) => [item.title, item.notes])
  ], query));
  const visibleSetlistIds = new Set(filteredSetlists.map((setlist) => setlist.id));

  return {
    tracks: filteredTracks,
    practiceEntries: filteredPracticeEntries,
    setlists: filteredSetlists,
    setlistItems: setlistItems.filter((item) => visibleSetlistIds.has(item.setlist_id))
  };
}

export function buildArchiveExport(data, exportedAt = new Date().toISOString()) {
  return {
    schema_version: 1,
    exported_at: exportedAt,
    tracks: data.tracks ?? [],
    practice_entries: data.practiceEntries ?? [],
    setlists: data.setlists ?? [],
    setlist_items: data.setlistItems ?? []
  };
}
