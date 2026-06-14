import { useCallback, useEffect, useRef, useState } from 'react';

const VIEWPORT = 288;   // on-screen square crop area (px)
const OUTPUT = 256;     // exported image size (px)

interface AvatarCropperProps {
  /** Source image (object URL or data URL) to crop. */
  src: string;
  busy?: boolean;
  onCancel: () => void;
  /** Receives the cropped image as a webp data URL. */
  onSave: (dataUrl: string) => void;
}

/**
 * Lets the user pan + zoom a chosen image inside a fixed square viewport, with a
 * circular guide showing how it will appear in the round avatar. Exports the
 * visible region as a 256x256 webp data URL — small enough to keep the whole
 * squad's photos to a couple of MB of Supabase Storage.
 */
export default function AvatarCropper({ src, busy, onCancel, onSave }: AvatarCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // Top-left of the rendered image relative to the viewport's top-left.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // baseScale makes the image "cover" the viewport at zoom 1.
  const baseScale = nat ? Math.max(VIEWPORT / nat.w, VIEWPORT / nat.h) : 1;
  const effScale = baseScale * zoom;
  const imgW = nat ? nat.w * effScale : 0;
  const imgH = nat ? nat.h * effScale : 0;

  // Keep the image covering the viewport (no empty gaps at the edges).
  const clamp = useCallback((x: number, y: number) => ({
    x: Math.min(0, Math.max(VIEWPORT - imgW, x)),
    y: Math.min(0, Math.max(VIEWPORT - imgH, y)),
  }), [imgW, imgH]);

  // Load the image and centre it.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = src;
  }, [src]);

  useEffect(() => {
    if (!nat) return;
    setOffset({ x: (VIEWPORT - imgW) / 2, y: (VIEWPORT - imgH) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat]);

  // Re-clamp whenever zoom changes, keeping the viewport centre anchored.
  function onZoom(next: number) {
    setOffset(prev => {
      const cx = VIEWPORT / 2, cy = VIEWPORT / 2;
      const ratio = (baseScale * next) / effScale;
      const nx = cx - (cx - prev.x) * ratio;
      const ny = cy - (cy - prev.y) * ratio;
      const nextImgW = nat!.w * baseScale * next;
      const nextImgH = nat!.h * baseScale * next;
      return {
        x: Math.min(0, Math.max(VIEWPORT - nextImgW, nx)),
        y: Math.min(0, Math.max(VIEWPORT - nextImgH, ny)),
      };
    });
    setZoom(next);
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.px;
    const dy = e.clientY - drag.current.py;
    setOffset(clamp(drag.current.ox + dx, drag.current.oy + dy));
  }
  function onPointerUp() { drag.current = null; }

  function handleSave() {
    if (!imgRef.current || !nat) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d')!;
    // Source rectangle (in natural px) currently visible in the viewport.
    const srcX = -offset.x / effScale;
    const srcY = -offset.y / effScale;
    const srcSize = VIEWPORT / effScale;
    ctx.drawImage(imgRef.current, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT);
    onSave(canvas.toDataURL('image/webp', 0.85));
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-extrabold text-gray-900">Adjust your photo</h2>
        <p className="text-xs text-gray-500 -mt-2">Drag to reposition, slide to zoom.</p>

        {/* Crop viewport */}
        <div
          className="relative mx-auto overflow-hidden rounded-lg bg-gray-100 touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {nat && (
            <img
              src={src}
              alt=""
              draggable={false}
              className="absolute max-w-none origin-top-left pointer-events-none"
              style={{ width: imgW, height: imgH, left: offset.x, top: offset.y }}
            />
          )}
          {/* Circular guide: darken outside the inscribed circle. */}
          <div className="absolute inset-0 pointer-events-none rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">−</span>
          <input
            type="range" min={1} max={3} step={0.01} value={zoom}
            onChange={e => onZoom(Number(e.target.value))}
            className="flex-1 accent-brand-green"
            aria-label="Zoom"
          />
          <span className="text-xs text-gray-400">+</span>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
          <button
            onClick={handleSave}
            disabled={busy || !nat}
            className="bg-brand-green hover:bg-brand-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {busy ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
