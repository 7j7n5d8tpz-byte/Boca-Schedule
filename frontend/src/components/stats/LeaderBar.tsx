import { Link } from 'react-router-dom';

// Horizontal leaderboard bar. When hubTo is set the name links to the
// player's profile hub.
export default function LeaderBar({ name, value, max, color, isMe, hubTo }: {
  name: string; value: number; max: number; color: string; isMe: boolean; hubTo?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const nameEl = (
    <>
      {name}{isMe && <span className="text-brand-green ml-1 text-[10px]">you</span>}
    </>
  );
  return (
    <div className={`flex items-center gap-3 py-1.5 ${isMe ? 'font-semibold' : ''}`}>
      {hubTo ? (
        <Link
          to={hubTo}
          state={{ from: '/statistics', fromLabel: 'Team stats' }}
          className="text-xs text-gray-700 w-28 truncate shrink-0 hover:text-brand-green hover:underline"
        >
          {nameEl}
        </Link>
      ) : (
        <span className="text-xs text-gray-700 w-28 truncate shrink-0">{nameEl}</span>
      )}
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-medium text-gray-600 w-4 text-right">{value}</span>
    </div>
  );
}
