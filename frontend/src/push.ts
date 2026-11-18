import { api } from './api/client';

// Web Push on this device: what the browser supports, what the player has
// chosen, and the subscribe/unsubscribe round trips with the backend.

export type PushState =
  | 'unsupported'      // browser has no push at all (old browser, in-app webview)
  | 'ios-install'      // iPhone/iPad in a Safari tab: push needs the home-screen app
  | 'default'          // can ask: show the opt-in
  | 'granted'          // allowed and subscribed
  | 'denied';          // said no; only the OS/browser settings can undo it

export function isIos(nav: Navigator = navigator): boolean {
  // iPadOS reports itself as a Mac, so also check for touch.
  return /iPad|iPhone|iPod/.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}

export function isStandalone(win: Window = window): boolean {
  return win.matchMedia?.('(display-mode: standalone)').matches
    || (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(win: Window = window): boolean {
  return 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win;
}

// The state ignoring whether a subscription exists yet — see getPushState.
export function permissionState(win: Window = window): PushState {
  if (isIos(win.navigator) && !isStandalone(win)) return 'ios-install';
  if (!pushSupported(win)) return 'unsupported';
  const p = (win as Window & { Notification: typeof Notification }).Notification.permission;
  return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'default';
}

let configPromise: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
export function pushConfig() {
  configPromise ??= api.get('/push/config')
    .then(r => r.data.data)
    .catch(() => ({ enabled: false, publicKey: null }));
  return configPromise;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('service worker registration failed', err);
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// Switching push off in settings leaves the browser permission at "granted",
// so remember the choice or syncPush would quietly subscribe again.
const OPTED_OUT_KEY = 'pushOptedOut';
function setOptedOut(v: boolean) {
  try {
    if (v) localStorage.setItem(OPTED_OUT_KEY, '1');
    else localStorage.removeItem(OPTED_OUT_KEY);
  } catch { /* storage blocked: worst case the next app start re-subscribes */ }
}
function optedOut(): boolean {
  try { return localStorage.getItem(OPTED_OUT_KEY) === '1'; } catch { return false; }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  await api.post('/push/subscriptions', { endpoint: json.endpoint, keys: json.keys });
}

// Must run inside a tap handler: iOS only shows the permission dialog for a
// user gesture. Resolves to the resulting state.
export async function enablePush(): Promise<PushState> {
  const { enabled, publicKey } = await pushConfig();
  if (!enabled || !publicKey) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';

  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  await saveSubscription(sub);
  setOptedOut(false);
  return 'granted';
}

export async function hasSubscription(): Promise<boolean> {
  return !!(await currentSubscription().catch(() => null));
}

// Opt this device out: drop the browser subscription and tell the backend.
export async function disablePush(): Promise<void> {
  setOptedOut(true);
  const sub = await currentSubscription();
  if (!sub) return;
  await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

// On log-out: stop this device receiving the previous player's notifications.
// The browser keeps its permission, so the next login re-subscribes silently.
export async function forgetDeviceOnServer(): Promise<void> {
  const sub = await currentSubscription().catch(() => null);
  if (sub) await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => {});
}

// On app start for a logged-in player who already allowed notifications:
// re-send the subscription (it can rotate, and it may belong to the previous
// login on this device) or create one if the browser dropped it.
export async function syncPush(): Promise<void> {
  if (permissionState() !== 'granted' || optedOut()) return;
  const { enabled, publicKey } = await pushConfig();
  if (!enabled || !publicKey) return;
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) return;
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  await saveSubscription(sub);
}

// "Ikke nu" hides the opt-in banner for a while. Per-device convenience only.
const SNOOZE_KEY = 'pushPromptSnoozedUntil';
const SNOOZE_DAYS = 14;

export function promptSnoozed(now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > now;
  } catch {
    return false;
  }
}

export function snoozePrompt(now = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch { /* private mode: the banner just comes back next visit */ }
}
