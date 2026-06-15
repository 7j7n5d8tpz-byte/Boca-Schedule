import { chromium } from '@playwright/test';

const SUPA = 'http://127.0.0.1:54321';
const KEY = process.env.SERVICE_ROLE_KEY;

// userId -> initials/color for a distinct generated portrait
const targets = [
  { id: '40aedb25-4836-4451-80a7-d3a01e7cc2a1', label: 'MA', c1: '#1e6f4c', c2: '#0c3b27' }, // Marcus (admin)
  { id: '435ce82d-0f74-415d-a553-64c63ba57cc8', label: 'TM', c1: '#2563eb', c2: '#1e3a8a' }, // Thomas
  { id: 'd6f6134f-e600-4a72-be28-0d3bce510a44', label: 'KL', c1: '#c2410c', c2: '#7c2d12' }, // Kasper
  { id: '00a79d36-2ae9-4cdd-92ae-15a38f35077d', label: 'JK', c1: '#7c3aed', c2: '#4c1d95' }, // Jonas
  { id: '73a1369f-fe5b-4980-ace9-d8bc4fc91911', label: 'CB', c1: '#0891b2', c2: '#155e75' }, // Christian
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const t of targets) {
  const dataUrl = await page.evaluate(({ c1, c2, label }) => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    // simple "portrait" silhouette
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath(); x.arc(128, 104, 52, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(128, 230, 90, 70, 0, Math.PI, 0, true); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.font = 'bold 64px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(label, 128, 120);
    return c.toDataURL('image/webp', 0.85);
  }, t);

  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const res = await fetch(`${SUPA}/storage/v1/object/avatars/${t.id}.webp`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'content-type': 'image/webp',
      'x-upsert': 'true',
    },
    body: bytes,
  });
  const url = `${SUPA}/storage/v1/object/public/avatars/${t.id}.webp?v=${Date.now()}`;
  // set avatar_url via PostgREST
  const upd = await fetch(`${SUPA}/rest/v1/users?user_id=eq.${t.id}`, {
    method: 'PATCH',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ avatar_url: url }),
  });
  console.log(t.label, 'upload', res.status, 'patch', upd.status);
}

await browser.close();
console.log('done');
