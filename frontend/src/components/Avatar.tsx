interface AvatarProps {
  src?: string | null;
  name?: string | null;
  /** Diameter in px. */
  size?: number;
  className?: string;
}

/**
 * Round profile picture with an initial-letter fallback when no photo is set.
 * Single source of truth for how avatars render across the app.
 */
export default function Avatar({ src, name, size = 40, className = '' }: AvatarProps) {
  const initial = name?.charAt(0)?.toUpperCase() ?? '?';
  return (
    <span
      className={`rounded-full overflow-hidden bg-brand-green/15 text-brand-green font-bold flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {src
        ? <img src={src} alt="" className="w-full h-full object-cover" />
        : initial}
    </span>
  );
}
