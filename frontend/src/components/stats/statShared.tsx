import CountUp from '../CountUp';

// Shared building blocks for the statistics pages (team stats + player hub).

// Mirror of the backend season helper: futsal seasons run Jul→Jun (so Nov–Feb
// fall in one season, keyed by the start year); outdoor = calendar year.
export function seasonStartYearClient(dateStr: string, matchType: string): number {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  if (matchType === 'futsal') return d.getMonth() + 1 >= 7 ? y : y - 1;
  return y;
}

export const POS_COLOR: Record<string, string> = {
  GK: 'bg-yellow-100 text-yellow-700',
  DEF: 'bg-blue-100 text-blue-700',
  WIN: 'bg-green-100 text-green-700',
  MID: 'bg-purple-100 text-purple-700',
  STR: 'bg-red-100 text-red-700',
};

export const CHART_COLORS = {
  goals: '#205B3B',      // brand green (kit)
  against: '#c41230',    // brand crimson (kit)
  assists: '#8b5cf6',
  cleanSheets: '#3da06a',
  attendance: '#f59e0b',
};

// ─── Small stat card ──────────────────────────────────────────────────────────

export function StatCard({ label, value, sub, color = 'text-gray-900' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className={`text-2xl font-bold font-numeric ${color}`}>{typeof value === 'number' ? <CountUp value={value} /> : value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Match label formatter ────────────────────────────────────────────────────

export function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Custom chart tooltips ────────────────────────────────────────────────────

export function ResultTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-medium text-gray-700">{label}</p>
      {d?.opponent && <p className="text-gray-400 mb-1">{d.date}</p>}
      {!d?.opponent && <div className="mb-1" />}
      {payload.map((entry: any) => (
        <p key={entry.name} style={{ color: entry.color }}>
          {entry.name}: <span className="font-semibold">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

export function RadarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow text-xs">
      <p className="font-semibold text-gray-700">{d.metric}</p>
      <p className="text-gray-900">{d.display}</p>
    </div>
  );
}
