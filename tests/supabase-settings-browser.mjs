import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const url = process.env.SETTINGS_HARNESS_URL || 'http://127.0.0.1:5175/settings.html';
const section = page.locator('#supabase');
const button = section.getByRole('button', {name: 'MCP Connector', exact: true});
let status = {connected: false, needsReconnect: false};
let statusError = false, startError = false, unsafeUrl = false, requests = 0, release;
await page.route('**/api/supabase/mcp', async route => {
  if (route.request().method() === 'GET') return route.fulfill({status: statusError ? 502 : 200, json: status});
  requests++;
  assert.equal(route.request().postData(), '{}');
  assert.equal(route.request().headers()['content-type'], 'application/json');
  await new Promise(resolve => { release = resolve; });
  return route.fulfill({status: startError ? 502 : 200, json: startError ? {error: 'failure'} : {authorizationUrl: unsafeUrl ? 'https://attacker.test/' : 'https://api.supabase.com/v1/oauth/authorize?client_id=fixture'}});
});
await page.route('https://api.supabase.com/v1/oauth/authorize**', route => route.fulfill({contentType:'text/html', body:'<h1>Supabase authorization test fixture</h1>'}));
try {
  await page.goto(`${url}#supabase`);
  await button.waitFor();
  await page.waitForFunction(() => !document.querySelector('#supabase')?.textContent?.includes('Menyemak'));
  assert.equal(await section.locator('button').count(), 1);
  assert.equal(await section.locator('input, form').count(), 0);
  await button.focus();
  await page.keyboard.press('Enter');
  await section.getByRole('status').filter({hasText: 'Membuka auth'}).waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-busy'), 'true');
  assert.equal(requests, 1);
  await page.waitForFunction(() => document.querySelector('#supabase button')?.disabled);
  release();
  await page.waitForURL('https://api.supabase.com/v1/oauth/authorize?client_id=fixture');

  startError = true;
  await page.goto(`${url}#supabase`);
  await button.click();
  await section.getByRole('status').filter({hasText:'Membuka auth'}).waitFor();
  release();
  await section.getByRole('alert').filter({hasText:'Sambungan gagal'}).waitFor();
  assert.equal(await button.isEnabled(), true);
  startError = false;
  unsafeUrl = true;
  await button.click();
  await section.getByRole('status').filter({hasText:'Membuka auth'}).waitFor();
  release();
  await section.getByRole('alert').filter({hasText:'Sambungan gagal'}).waitFor();
  assert.ok(page.url().startsWith(url));
  unsafeUrl = false;

  await page.goto(`${url}?supabase_mcp=cancelled#supabase`);
  await section.getByRole('status').filter({hasText:'Auth dibatalkan'}).waitFor();
  assert.ok(!page.url().includes('supabase_mcp='));
  await page.goto(`${url}?supabase_mcp=failed#supabase`);
  await section.getByRole('alert').filter({hasText:'Sambungan gagal'}).waitFor();
  status = {connected: true, needsReconnect: false};
  await page.goto(`${url}?supabase_mcp=connected#supabase`);
  await section.getByRole('status').filter({hasText:'MCP Supabase disambungkan'}).waitFor();
  assert.ok((await section.textContent()).includes('Sambungan data aplikasi belum diaktifkan'));
  status = {connected: false, needsReconnect: true};
  await page.goto(`${url}?scenario=expired#supabase`);
  await section.getByRole('status').filter({hasText:'Sambungan tamat'}).waitFor();
  statusError = true;
  await page.goto(`${url}?scenario=status-error#supabase`);
  await section.getByRole('alert').filter({hasText:'Status sambungan tidak dapat dimuatkan'}).waitFor();
  assert.equal(await button.isEnabled(), true);
  statusError = false;
  status = {connected: false, needsReconnect: false};
  await page.goto(`${url}?scenario=responsive#supabase`);
  await button.waitFor();
  await mkdir('reports/supabase-settings', {recursive:true});
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({width, height:1000});
    await section.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path:`reports/supabase-settings/settings-${width}.png`,fullPage:true});
  }
  assert.deepEqual(errors, []);
  console.log('PASS MCP connector: one button, keyboard, pending, OAuth redirect, retry, unsafe URL, callback states, reconnect and responsive widths');
} finally {await browser.close();}
