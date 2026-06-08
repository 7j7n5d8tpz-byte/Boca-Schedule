const STAT_ICONS = {
  ball: '/icon-ball.png',
  glove: '/icon-glove.png',
  star: '/icon-star.png',
  target: '/icon-target.png',
} as const;

export type StatIconName = keyof typeof STAT_ICONS;

/** Raster sport icons. Default black; `white` for dark backgrounds, `gray` to sit with outline icons. */
export default function StatIcon({
  name,
  className = 'w-6 h-6',
  white = false,
  gray = false,
}: {
  name: StatIconName;
  className?: string;
  white?: boolean;
  gray?: boolean;
}) {
  const suffix = white ? '-white' : gray ? '-gray' : '';
  const src = suffix ? STAT_ICONS[name].replace('.png', `${suffix}.png`) : STAT_ICONS[name];
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={`${className} object-contain inline-block shrink-0`}
    />
  );
}

/** A small football card chip (yellow/red) — replaces the 🟨/🟥 emojis. */
export function CardChip({ color, className = '' }: { color: 'yellow' | 'red'; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block w-2.5 h-3.5 rounded-[2px] shrink-0 ${
        color === 'yellow' ? 'bg-yellow-400' : 'bg-red-500'
      } ${className}`}
    />
  );
}
