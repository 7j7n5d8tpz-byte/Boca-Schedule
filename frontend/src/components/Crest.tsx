// Achievement crest. Composites the designed SVG sprite (see CrestSprite + the
// crest-sprite.svg asset): a tier shield (#tier-…), a medallion holding the
// achievement's unique emblem (#emblem-…), and a tier-label ribbon. Size, locked
// state and the legend aura are handled here. The sprite must be mounted once
// (App renders <CrestSprite/>).

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'champion' | 'legend';

export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion', 'legend'];
export const tierRank = (t: Tier) => TIERS.indexOf(t);

export type GlyphName =
  | 'football' | 'boot' | 'glove' | 'medal' | 'calendar' | 'clipboard'
  | 'flame' | 'chain' | 'bolt' | 'trophy' | 'fortress' | 'swords';

interface TierMeta {
  label: string;
  from: string;   // light accent (kept for callers/charts)
  to: string;     // dark accent (kept for callers/charts)
  ribbon: string; // tier text colour used around the app
  med: string;    // medallion fill (light)
  ink: string;    // emblem ink + ribbon fill (dark)
}

export const TIER_META: Record<Tier, TierMeta> = {
  bronze:   { label: 'Bronze',   from: '#d79a5b', to: '#7a4a23', ribbon: '#5e3818', med: '#f5efe6', ink: '#6e3a24' },
  silver:   { label: 'Silver',   from: '#eef2f6', to: '#8b9097', ribbon: '#5b6068', med: '#f7fbff', ink: '#56636f' },
  gold:     { label: 'Gold',     from: '#f7d774', to: '#9a6a12', ribbon: '#6f4d0c', med: '#fff7c8', ink: '#8f5b0f' },
  platinum: { label: 'Platinum', from: '#a7d8d0', to: '#3f6f67', ribbon: '#235f67', med: '#effffd', ink: '#1b4f5b' },
  diamond:  { label: 'Diamond',  from: '#8ef0ff', to: '#1859b8', ribbon: '#164a9a', med: '#f4fdff', ink: '#1859b8' },
  champion: { label: 'Champion', from: '#ef5a72', to: '#9a0c22', ribbon: '#7b0719', med: '#fff2b2', ink: '#7b0719' },
  legend:   { label: 'Legend',   from: '#ffe65c', to: '#205b3b', ribbon: '#1a1d22', med: '#fffbe9', ink: '#1a1d22' },
};

let uid = 0;

interface CrestProps {
  glyph: GlyphName;
  tier: Tier;
  /** Width in px (height is 1.16×). */
  size?: number;
  /** Desaturate + dim for a not-yet-earned crest. */
  locked?: boolean;
  /** Show the tier ribbon (default true). */
  showRibbon?: boolean;
  className?: string;
  title?: string;
}

export default function Crest({ glyph, tier, size = 96, locked = false, showRibbon = true, className = '', title }: CrestProps) {
  const m = TIER_META[tier];
  const maskId = `crest-emblem-${(uid += 1)}`;

  return (
    <div
      className={`relative inline-block ${locked ? 'grayscale opacity-50' : ''} ${tier === 'legend' && !locked ? 'crest-aura' : ''} ${className}`}
      style={{ width: size, height: size * 1.16 }}
      title={title}
    >
      <svg viewBox="0 0 100 116" width={size} height={size * 1.16} className="overflow-visible">
        {/* Tier shield (designed sprite) */}
        <use href={`#tier-${tier}`} />

        {/* Medallion + emblem (emblem rendered as the dark ink via a mask) */}
        <circle cx="50" cy="37" r="17.5" fill={m.med} />
        <mask id={maskId}>
          <rect width="100" height="116" fill="#000" />
          <use href={`#emblem-${glyph}`} x="35" y="22" width="30" height="30" />
        </mask>
        <rect x="35" y="22" width="30" height="30" fill={m.ink} mask={`url(#${maskId})`} />

        {/* Tier ribbon */}
        {showRibbon && (
          <g>
            <path d="M16 70h68v15H16z" fill={m.ink} />
            <path d="M16 70l-6 5 6 9M84 70l6 5-6 9" fill={m.ink} opacity="0.85" />
            <path d="M16 70h68" stroke="#ffffff" strokeWidth="1.4" opacity="0.25" />
            <text x="50" y="80.5" textAnchor="middle" fontFamily="Archivo, system-ui, sans-serif"
              fontSize="8.6" fontWeight="700" letterSpacing="1.1" fill="#fff">
              {m.label.toUpperCase()}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
