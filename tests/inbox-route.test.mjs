import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const browser = await chromium.launch({headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const page = await browser.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const calls = () => page.evaluate(() => window.routeHarness.calls);
const retries = async () => (await calls()).filter(call => call.kind === 'retry');
const finish = outcome => page.evaluate(value => window.routeHarness.finish(value), outcome);
try {
 await page.goto('http://127.0.0.1:5175/route.html');
 const retry = page.getByRole('button', {name: 'Cuba Semula', exact: true});
 await retry.waitFor();
 assert.equal((await page.textContent('body')).includes('SECRET_TEST'), false);
 // Dispatch both clicks in a single turn, before React can render disabled state.
 await retry.evaluate(button => {button.click(); button.click();});
 await page.getByRole('button', {name: 'Mencuba semula…', exact: true}).waitFor();
 assert.deepEqual(await retries(), [{kind: 'retry', id: 'message-a'}]);
 const beforeFailure = (await calls()).filter(call => call.kind === 'list' && call.id === 'chat-a').length;
 await finish('failed');
 await page.getByRole('alert').filter({hasText: 'Penghantaran semula gagal'}).waitFor();
 await retry.waitFor();
 assert.equal((await page.textContent('body')).includes('SECRET_TEST'), false);
 assert.ok((await calls()).filter(call => call.kind === 'list' && call.id === 'chat-a').length > beforeFailure);
 console.log('PASS actual inbox route: correct server function ID, double-click lock, failed retry and refreshed status');
 await retry.click();
 await page.getByRole('button', {name: 'Mencuba semula…', exact: true}).waitFor();
 await page.getByRole('button', {name: /Badrul/}).click();
 await page.getByText('Balasan b', {exact: true}).waitFor();
 assert.equal(await retry.isDisabled(), true);
 // Track invalidation itself: an inactive chat is invalidated but not immediately fetched.
 await page.evaluate(() => {
  window.invalidatedChats = [];
  const client = window.routeQueryClient;
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = (...args) => { window.invalidatedChats.push(args[0].queryKey); return original(...args); };
 });
 await finish('sent');
 await page.waitForFunction(() => window.invalidatedChats.some(key => key[0] === 'messages' && key[1] === 'chat-a'));
 assert.equal(await page.getByText('Balasan b', {exact: true}).count(), 1);
 await page.getByRole('button', {name: /Aina/}).click();
 await page.getByText('Diterima Meta', {exact: true}).waitFor();
 assert.equal(await page.getByText('Balasan a', {exact: true}).count(), 1);
 assert.equal(await retry.count(), 0);
 assert.deepEqual(await retries(), [{kind: 'retry', id: 'message-a'}, {kind: 'retry', id: 'message-a'}]);
 assert.deepEqual(errors, []);
 console.log('PASS actual inbox route: chat switch preserves retry target, invalidates original chat and updates same bubble');
} finally { await browser.close(); }
