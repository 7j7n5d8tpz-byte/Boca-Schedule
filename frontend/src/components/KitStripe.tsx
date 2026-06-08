// The team-kit stripe — green / crimson / green, mirroring the BocaBoldisch shirt's
// centre stripe. Signature identity accent (page-title accents, card edges, nav underline).
export default function KitStripe({
  orientation = 'vertical',
  className = '',
}: {
  orientation?: 'vertical' | 'horizontal';
  className?: string;
}) {
  if (orientation === 'horizontal') {
    return (
      <div className={`flex flex-col w-full ${className}`} aria-hidden>
        <div className="h-[2px] bg-brand-green" />
        <div className="h-[2px] bg-brand-red" />
        <div className="h-[2px] bg-brand-green" />
      </div>
    );
  }
  return (
    <div className={`flex ${className}`} aria-hidden>
      <div className="w-1 bg-brand-green rounded-l-sm" />
      <div className="w-1 bg-brand-red" />
      <div className="w-1 bg-brand-green rounded-r-sm" />
    </div>
  );
}
