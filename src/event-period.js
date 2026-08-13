export function filterEventsByPeriod(events, period, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekdayFromMonday = (now.getDay() + 6) % 7;
  const startOfWeek = startOfToday - (weekdayFromMonday * 86_400_000);
  const endOfWeek = startOfWeek + (7 * 86_400_000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  return events.filter((event) => {
    const timestamp = event.starts_at ? new Date(event.starts_at).getTime() : Number.NaN;
    if (period === 'all') return true;
    if (Number.isNaN(timestamp)) return period === 'upcoming';
    if (period === 'week') return timestamp >= startOfWeek && timestamp < endOfWeek;
    if (period === 'month') return timestamp >= startOfMonth && timestamp < endOfMonth;
    return timestamp >= startOfToday;
  });
}
