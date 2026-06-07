import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts';
import { api } from '../../api/client';
import { formatKr as kr } from './finesUtil';

const GREEN = '#205B3B';
const AMBER = '#f59e0b';

interface StatsData {
  availableYears: number[];
  pot: { collectedDkk: number; outstandingDkk: number; totalDkk: number };
  topFined: { playerId: string; name: string; totalDkk: number; count: number }[];
  topPerGame: { playerId: string; name: string; totalDkk: number; games: number; perGameDkk: number }[];
  saints: string[];
  favouriteFine: { label: string; count: number; totalDkk: number } | null;
  perGameDkk: number;
  biggestFine: { playerName: string; label: string; amountDkk: number; when: string } | null;
  mostExpensiveMatch: { label: string; totalDkk: number } | null;
  typeBreakdown: { label: string; count: number; totalDkk: number }[];
  overTime: { period: string; label: string; totalDkk: number }[];
  fineCount: number;
}

export default function FinesStats() {
  const [year, setYear] = useState<string>('all');
  const { data } = useQuery<StatsData>({
    queryKey: ['fines-stats', year],
    queryFn: () => api.get(`/fines/stats${year === 'all' ? '' : `?year=${year}`}`).then(r => r.data.data),
  });

  if (!data) return <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">Loading…</div>;

  if (data.fineCount === 0) {
    return (
      <div className="space-y-4">
        <YearFilter year={year} setYear={setYear} years={data.availableYears} />
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">No fines yet — nothing to brag about. 😇</div>
      </div>
    );
  }

  const king = data.topFined[0];
  const chartTypes = data.typeBreakdown.slice(0, 8);

  return (
    <div className="space-y-6">
      <YearFilter year={year} setYear={setYear} years={data.availableYears} />

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile emoji="💰" value={kr(data.pot.totalDkk)} label="The pot" sub={`${kr(data.pot.collectedDkk)} in · ${kr(data.pot.outstandingDkk)} owed`} />
        <Tile emoji="👑" value={king?.name.split(' ')[0] ?? '—'} label="Bødekongen" sub={king ? kr(king.totalDkk) : ''} />
        <Tile emoji="🧾" value={data.favouriteFine?.label ?? '—'} label="Favourite fine" sub={data.favouriteFine ? `${data.favouriteFine.count}×` : ''} small />
        <Tile emoji="⚽" value={kr(data.perGameDkk)} label="Per game" sub="avg / match" />
      </div>

      {/* Leaderboards */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Panel title="Top fined">
          <ol className="divide-y divide-gray-50">
            {data.topFined.map((p, i) => (
              <li key={p.playerId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400 w-4 shrink-0">{i + 1}.</span>
                  <span className="font-medium text-gray-800 truncate">{p.name}</span>
                </span>
                <span className="shrink-0 text-gray-500">{kr(p.totalDkk)} <span className="text-gray-300">· {p.count}</span></span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Most fined per game">
          {data.topPerGame.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">No match fines yet.</p>
          ) : (
            <ol className="divide-y divide-gray-50">
              {data.topPerGame.map((p, i) => (
                <li key={p.playerId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-400 w-4 shrink-0">{i + 1}.</span>
                    <span className="font-medium text-gray-800 truncate">{p.name}</span>
                  </span>
                  <span className="shrink-0 text-gray-500">{kr(p.perGameDkk)}/game <span className="text-gray-300">· {p.games}g</span></span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title={`The saints (${data.saints.length})`}>
          {data.saints.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">Nobody — everyone's been fined 😈</p>
          ) : (
            <div className="px-4 py-3 flex flex-wrap gap-1.5">
              {data.saints.map(n => (
                <span key={n} className="text-xs bg-brand-green-50 text-brand-green px-2 py-1 rounded-full">{n}</span>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Biggest single fine">
          {data.biggestFine ? (
            <div className="px-4 py-3">
              <p className="text-2xl font-bold text-gray-900">{kr(data.biggestFine.amountDkk)}</p>
              <p className="text-sm text-gray-700">{data.biggestFine.playerName} — {data.biggestFine.label}</p>
              <p className="text-xs text-gray-400">{data.biggestFine.when}</p>
            </div>
          ) : <p className="px-4 py-3 text-sm text-gray-400">—</p>}
        </Panel>

        <Panel title="Most expensive match">
          {data.mostExpensiveMatch ? (
            <div className="px-4 py-3">
              <p className="text-2xl font-bold text-gray-900">{kr(data.mostExpensiveMatch.totalDkk)}</p>
              <p className="text-sm text-gray-700">{data.mostExpensiveMatch.label}</p>
            </div>
          ) : <p className="px-4 py-3 text-sm text-gray-400">No match fines yet.</p>}
        </Panel>
      </div>

      {/* Charts */}
      <Panel title="What we get fined for">
        <div className="p-3">
          <ResponsiveContainer width="100%" height={chartTypes.length * 38 + 10}>
            <BarChart data={chartTypes} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={((value: any, _name: any, item: any) => [`${value}× · ${kr(item?.payload?.totalDkk ?? 0)}`, 'Fines']) as any} />
              <Bar dataKey="count" fill={GREEN} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {data.overTime.length > 1 && (
        <Panel title="Fines over time">
          <div className="p-3">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.overTime} margin={{ left: -10, right: 16, top: 6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={((value: any) => [kr(Number(value)), 'Fined']) as any} />
                <Line type="monotone" dataKey="totalDkk" stroke={AMBER} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}
    </div>
  );
}

function YearFilter({ year, setYear, years }: { year: string; setYear: (y: string) => void; years: number[] }) {
  return (
    <select
      value={year}
      onChange={e => setYear(e.target.value)}
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-green bg-white"
    >
      <option value="all">All years</option>
      {years.map(y => <option key={y} value={y}>{y}</option>)}
    </select>
  );
}

function Tile({ emoji, value, label, sub, small }: { emoji: string; value: string; label: string; sub?: string; small?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-lg">{emoji}</p>
      <p className={`font-bold text-gray-900 leading-tight ${small ? 'text-sm' : 'text-xl'} truncate`} title={value}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">{title}</h3>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">{children}</div>
    </div>
  );
}
