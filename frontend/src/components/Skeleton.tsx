// Lightweight loading placeholders — a pulsing block primitive plus a couple of
// composed shapes that mirror the real match-card layout, so loading states feel
// like content arriving rather than a bare "Loading…" string.

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

function MatchCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => <MatchCardSkeleton key={i} />)}
    </div>
  );
}
