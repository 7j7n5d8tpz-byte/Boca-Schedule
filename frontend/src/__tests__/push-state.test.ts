import { describe, it, expect, beforeEach } from 'vitest';
import { permissionState, promptSnoozed, snoozePrompt } from '../push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

function fakeWindow(opts: {
  ua: string; standalone?: boolean; push?: boolean; permission?: NotificationPermission;
  platform?: string; touch?: number;
}): Window {
  const nav: Record<string, unknown> = {
    userAgent: opts.ua, platform: opts.platform ?? '', maxTouchPoints: opts.touch ?? 0,
  };
  if (opts.push !== false) nav.serviceWorker = {};
  const win: Record<string, unknown> = {
    navigator: nav,
    matchMedia: () => ({ matches: !!opts.standalone }),
  };
  if (opts.push !== false) {
    win.PushManager = function PushManager() {};
    win.Notification = { permission: opts.permission ?? 'default' };
  }
  return win as unknown as Window;
}

describe('permissionState', () => {
  it('asks iPhone players in a Safari tab to add the app to the home screen first', () => {
    // iOS Safari tabs have no PushManager at all, so this must win over "unsupported".
    expect(permissionState(fakeWindow({ ua: IPHONE, push: false }))).toBe('ios-install');
  });

  it('treats an iPad (which reports itself as a Mac) the same way', () => {
    expect(permissionState(fakeWindow({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', touch: 5, push: false })))
      .toBe('ios-install');
  });

  it('offers the opt-in inside the iPhone home-screen app', () => {
    expect(permissionState(fakeWindow({ ua: IPHONE, standalone: true }))).toBe('default');
  });

  it('follows the browser permission on Android', () => {
    expect(permissionState(fakeWindow({ ua: ANDROID }))).toBe('default');
    expect(permissionState(fakeWindow({ ua: ANDROID, permission: 'granted' }))).toBe('granted');
    expect(permissionState(fakeWindow({ ua: ANDROID, permission: 'denied' }))).toBe('denied');
  });

  it('reports browsers without push as unsupported', () => {
    expect(permissionState(fakeWindow({ ua: ANDROID, push: false }))).toBe('unsupported');
  });
});

describe('opt-in snooze', () => {
  beforeEach(() => localStorage.clear());

  it('hides the banner for 14 days after "Not now"', () => {
    const now = Date.UTC(2026, 10, 18);
    expect(promptSnoozed(now)).toBe(false);
    snoozePrompt(now);
    expect(promptSnoozed(now + 13 * 24 * 60 * 60 * 1000)).toBe(true);
    expect(promptSnoozed(now + 15 * 24 * 60 * 60 * 1000)).toBe(false);
  });
});
