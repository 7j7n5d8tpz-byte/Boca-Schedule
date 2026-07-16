import Crest, { type Tier, type GlyphName } from './Crest';

// A clickable crest with a hover tooltip (desktop nicety) — tapping it should
// open BadgeDetailModal via onClick for the full description on any device.
export default function CrestButton({ glyph, tier, size, label, onClick, locked }: {
  glyph: GlyphName; tier: Tier; size: number; label: string; onClick?: () => void; locked?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="relative group shrink-0" aria-label={label}>
      <Crest glyph={glyph} tier={tier} size={size} showRibbon={false} locked={locked} />
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-10 hidden group-hover:block whitespace-nowrap rounded bg-gray-900 text-white text-[11px] px-2 py-1 shadow-lg">
        {label}
      </span>
    </button>
  );
}
