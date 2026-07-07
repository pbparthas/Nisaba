// UI smoke: cream theme + subtasks flow, offline (no Drive), phone viewport.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 420, height: 840 } });
  page.on('pageerror', (e) => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto('http://localhost:4173');

  // Create the "Buy medicine" task
  await page.click('[data-tab], .tab:has-text("Tasks")').catch(() => page.click('.tab >> text=Tasks'));
  await page.fill('.task-form input[placeholder="Add a task…"]', 'Buy medicine');
  await page.click('.task-form button[type=submit]');
  await page.waitForSelector('li.task');

  // Expand and add subtasks
  await page.click('li.task .body');
  for (const med of ['Paracetamol', 'Vitamin D', 'Antihistamine']) {
    await page.fill('.subtask-form input', med);
    await page.click('.subtask-form button');
  }
  await page.waitForFunction(() => document.querySelectorAll('.subtask').length === 3);

  // Toggle two done, verify counter
  const boxes = await page.$$('.subtask input[type=checkbox]');
  await boxes[0].click();
  await boxes[1].click();
  await page.waitForFunction(() => document.querySelector('.subcount')?.textContent === '2/3');
  console.log('subtask counter:', await page.textContent('.subcount'));

  // Reload — persisted from IndexedDB
  await page.reload();
  await page.click('.tab >> text=Tasks');
  await page.waitForSelector('.subcount');
  console.log('after reload counter:', await page.textContent('.subcount'));

  // A note for the screenshot's notes tab context, then screenshot tasks view
  await page.click('li.task .body'); // expand for the shot
  await page.waitForSelector('.subtask');
  await page.screenshot({ path: 'nisaba-cream-ui.png' });
  await browser.close();
  console.log('UI SUBTASKS TEST PASSED');
})();
