import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
const errs = [];
p.on('console', m => { if (m.type()==='error') errs.push('CONSOLE: '+m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
p.on('response', r => { if (r.url().includes('/api/announcements')) errs.push(`API ${r.request().method()} ${r.status()}`); });

await p.goto('http://localhost:5173/login');
await p.fill('input[type=email]', 'coach@boca.test');
await p.fill('input[type=password]', 'Coach123!');
await p.click('button[type=submit]');
await p.waitForLoadState('networkidle');
await p.goto('http://localhost:5173/coach');
await p.waitForTimeout(1500);
errs.push('URL after /coach: '+p.url());

let editBtns = await p.getByRole('button', { name: 'Edit' }).count();
errs.push('Edit buttons found: '+editBtns);
if (editBtns === 0) {
  await p.locator('textarea').first().fill('repro announcement');
  await p.getByRole('button', { name: 'Post' }).click();
  await p.waitForTimeout(1500);
}
await p.getByRole('button', { name: 'Edit' }).first().click();
await p.waitForTimeout(300);
await p.locator('textarea').last().fill('edited via repro '+Date.now());
await p.getByRole('button', { name: 'Save' }).first().click();
await p.waitForTimeout(2000);
errs.push('Save still visible: '+ await p.getByRole('button', { name: 'Save' }).count());
console.log(errs.join('\n'));
await b.close();
