export function meetingTime(matchTime: string): string {
  const [h, m] = matchTime.split(':').map(Number);
  const total = h * 60 + m - 60;
  // Use double-modulo to wrap negative values (e.g. -30 min → 23:30)
  const mh = String(((Math.floor(total / 60) % 24) + 24) % 24).padStart(2, '0');
  const mm = String(((total % 60) + 60) % 60).padStart(2, '0');
  return `${mh}:${mm}`;
}
