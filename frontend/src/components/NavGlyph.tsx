// Outline glyphs for the navigation (24×24, currentColor) — one per page or
// menu action. Shared by the bottom bar / top bar (AppNav) and the "More" sheet.
export type GlyphId =
  | 'home' | 'stats' | 'achievements' | 'fines' | 'coach' | 'more'
  | 'admin' | 'settings' | 'logout';

const GLYPH: Record<GlyphId, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z',
  stats: 'M4 20V10M10 20V4M16 20v-7M2 20h20',
  achievements: 'M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3Zm-3 9 2.2 2.2L15 10.5',
  fines: 'M3 7h18v10H3V7Zm9 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 10.5v3M17.5 10.5v3',
  coach: 'M9 4h6v3H9V4ZM6 7h12v13H6V7Zm3 5h6M9 16h4',
  more: 'M5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm7 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  admin: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M7 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H4',
};

export default function Glyph({ id, className = 'w-[22px] h-[22px]' }: { id: GlyphId; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={GLYPH[id]} />
    </svg>
  );
}
