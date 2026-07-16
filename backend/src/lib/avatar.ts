import { supabaseAdmin } from './supabase.js';

const MAX_AVATAR_BYTES = 2_097_152; // 2 MB

/** Zod-friendly regex for an accepted avatar data URL (base64 webp/jpeg/png). */
export const AVATAR_DATA_URL_RE = /^data:image\/(webp|jpeg|png);base64,/;

/** Thrown when a decoded avatar exceeds the storage size limit. */
export class AvatarTooLargeError extends Error {
  constructor() {
    super('Image too large');
    this.name = 'AvatarTooLargeError';
  }
}

/**
 * Decodes a base64 image data URL, stores it in the public `avatars` bucket at a
 * stable per-user path (upsert overwrites the previous photo), and returns the
 * cache-busted public URL. The caller is responsible for persisting the URL on
 * the user row. Throws {@link AvatarTooLargeError} when the decoded image
 * exceeds {@link MAX_AVATAR_BYTES}.
 */
export async function storeAvatar(userId: string, dataUrl: string): Promise<string> {
  const [meta, b64] = dataUrl.split(',');
  const ext = meta.includes('webp') ? 'webp' : meta.includes('png') ? 'png' : 'jpeg';
  const contentType = `image/${ext}`;
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.byteLength > MAX_AVATAR_BYTES) throw new AvatarTooLargeError();

  const path = `${userId}.${ext}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from('avatars')
    .upload(path, buffer, { contentType, upsert: true });
  if (uploadError) throw uploadError;

  const { data: pub } = supabaseAdmin.storage.from('avatars').getPublicUrl(path);
  // Cache-bust so the new image shows immediately despite the stable path.
  return `${pub.publicUrl}?v=${Date.now()}`;
}
