import { useTranslation } from 'react-i18next';

// The app's loading indicator: the crest flipping like a coin (see `.boca-coin`
// in index.css). Skeletons stay the choice for lists; this replaces the plain
// "Loading…" texts and spinners.
//   page   — fills the screen (route / whole-page loads)
//   card   — centred inside a card or panel
//   inline — a small crest next to a line of text
const SIZE = {
  page: { wrap: 'min-h-screen boca-page flex flex-col items-center justify-center gap-5', img: 'w-28 h-28', text: 'font-display font-bold text-lg text-brand-dark' },
  card: { wrap: 'flex items-center justify-center gap-3 py-8', img: 'w-10 h-10', text: 'text-sm text-gray-500' },
  inline: { wrap: 'inline-flex items-center gap-2', img: 'w-5 h-5', text: 'text-sm text-gray-500' },
} as const;

export default function BocaLoader({
  size = 'card',
  label,
  className = '',
}: {
  size?: keyof typeof SIZE;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const s = SIZE[size];
  return (
    <div role="status" className={`${s.wrap} ${className}`}>
      <img src="/boca-logo.png" alt="" aria-hidden="true" className={`${s.img} boca-coin`} />
      <span className={s.text}>{label ?? t('common.loading')}</span>
    </div>
  );
}
