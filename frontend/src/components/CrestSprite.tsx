import sprite from '../assets/crest-sprite.svg?raw';

// Injects the crest SVG sprite (12 emblems + 7 tier shields + gradients/filters)
// into the document ONCE so every <Crest> can reference its <symbol>s via local
// <use href="#tier-…"> / <use href="#emblem-…">. Inlining (rather than external
// <use href="file.svg#id">) keeps gradient/filter references resolving reliably
// across browsers, including Safari. Mount once near the app root.
export default function CrestSprite() {
  return <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: sprite }} />;
}
