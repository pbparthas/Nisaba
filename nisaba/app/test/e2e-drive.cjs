// Browser E2E: two devices (browser contexts) sync a note + image attachment
// through the mock Drive server, with Google auth stubbed out.
const { chromium } = require('playwright-core');
const { startMockDrive } = require('./mock-drive.js');

const GIS_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient(cfg) {
    return {
      callback: cfg.callback,
      requestAccessToken() { setTimeout(() => this.callback({ access_token: 'e2e-token', expires_in: 3600 }), 0); },
    };
  },
  revoke(t, cb) { cb && cb(); },
}}};
`;

// 1x1 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function newDevice(browser, mock) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  await ctx.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: GIS_STUB }));
  await ctx.route('https://www.googleapis.com/**', (route) => {
    const url = new URL(route.request().url());
    return route.fetch({ url: mock.baseUrl + url.pathname + url.search }).then((r) => route.fulfill({ response: r }));
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.addInitScript(() => {
    localStorage.setItem('ns_client_id', 'e2e.apps.googleusercontent.com');
    localStorage.setItem('ns_signed_in', '1');
  });
  await page.goto('http://localhost:4173');
  return { ctx, page };
}

(async () => {
  const mock = await startMockDrive();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  // Device A: create a note with an attachment
  const a = await newDevice(browser, mock);
  await a.page.click('.fab');
  await a.page.fill('input[placeholder="Title"]', 'Trip plan');
  await a.page.fill('textarea', 'Pack camera, book hotel');
  await a.page.setInputFiles('input[type=file]', { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await a.page.waitForSelector('.thumbs img');
  console.log('A: attachment thumbnail rendered');
  await a.page.click('text=Done');
  await a.page.waitForFunction(() => document.querySelector('.pill')?.textContent === 'synced');
  console.log('A: synced');

  const driveNames = [...mock._files.values()].map((f) => f.name);
  console.log('mock Drive now holds:', driveNames.join(', '));

  // Device B: fresh profile, must receive note + lazily fetch the image
  const b = await newDevice(browser, mock);
  await b.page.waitForSelector('.items li');
  console.log('B: note arrived:', await b.page.textContent('.items li h3'));
  await b.page.click('.items li');
  await b.page.waitForSelector('.thumbs img');
  console.log('B: attachment downloaded and rendered');

  // Device B edits; device A picks it up on its next 30s cycle (force via focus)
  await b.page.fill('input[placeholder="Title"]', 'Trip plan v2');
  await b.page.click('text=Done');
  await b.page.waitForFunction(() => document.querySelector('.pill')?.textContent === 'synced');
  await a.page.dispatchEvent('body', 'focus');
  await a.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await a.page.waitForFunction(() =>
    [...document.querySelectorAll('.items li h3')].some((h) => h.textContent === 'Trip plan v2'));
  console.log('A: received edit from B');

  await b.page.screenshot({ path: 'nisaba-e2e.png' });
  await browser.close();
  mock.close();
  console.log('E2E PASSED');
})();
