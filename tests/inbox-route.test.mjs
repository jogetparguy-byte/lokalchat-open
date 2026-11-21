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
 await page.getByRole('main').getByText('Diterima Meta', {exact: true}).waitFor();
 assert.equal(await page.getByText('Balasan a', {exact: true}).count(), 1);
 assert.equal(await retry.count(), 0);
 assert.deepEqual(await retries(), [{kind: 'retry', id: 'message-a'}, {kind: 'retry', id: 'message-a'}]);
 assert.deepEqual(errors, []);
 console.log('PASS actual inbox route: chat switch preserves retry target, invalidates original chat and updates same bubble');

 const panel = page.getByRole('region', {name: 'Tugasan handoff'});
 const openTasks = panel.getByRole('list', {name: 'Tugasan terbuka'});
 const task = (name) => openTasks.getByRole('listitem').filter({
   has: page.getByRole('heading', {name, exact: true}),
 });
 const overdue = task('Aina');
 await overdue.getByText('Lewat', {exact: true}).waitFor();
 await task('Badrul').getByText('Diterima Meta', {exact: true}).waitFor();
 assert.equal((await panel.textContent()).includes('SECRET_TEST'), false);
 const uncertain = overdue.getByRole('listitem').filter({hasText: 'Penghantaran belum disahkan'});
 const tryUncertain = uncertain.getByRole('button', {name: 'Cuba semula amaran'});
 const dialog = page.getByRole('alertdialog', {name: 'Cuba semula amaran WhatsApp?'});
 await tryUncertain.focus();
 await page.keyboard.press('Enter');
 await dialog.getByText(/boleh menghasilkan amaran pendua/).waitFor();
 assert.equal(await dialog.getByRole('button', {name: 'Batal'}).evaluate(button => document.activeElement === button), true);
 await page.keyboard.press('Escape');
 await dialog.waitFor({state: 'hidden'});
 assert.equal(await tryUncertain.evaluate(button => document.activeElement === button), true);
 const alertRetries = async () => (await calls()).filter(call => call.kind === 'handoff-retry');
 assert.deepEqual(await alertRetries(), []);
 await tryUncertain.click();
 await dialog.getByRole('button', {name: 'Sahkan cubaan semula'}).evaluate(button => {
   button.click();
   button.click();
 });
 await overdue.getByText('Dalam giliran', {exact: true}).waitFor();
 assert.deepEqual(await alertRetries(), [{kind: 'handoff-retry', id: 'notice-uncertain'}]);
 await overdue.getByRole('button', {name: 'Cuba semula amaran'}).click();
 await overdue.getByText('Penghantaran gagal', {exact: true}).waitFor({state: 'detached'});
 assert.deepEqual(await alertRetries(), [
   {kind: 'handoff-retry', id: 'notice-uncertain'},
   {kind: 'handoff-retry', id: 'notice-failed'},
 ]);

 await overdue.getByRole('button', {name: 'Terima tugasan'}).click();
 await panel.getByRole('alert').filter({hasText: 'Tugasan gagal dikemas kini'}).waitFor();
 await overdue.getByRole('button', {name: 'Terima tugasan'}).click();
 await overdue.getByText('Diterima', {exact: true}).waitFor();
 assert.equal(await overdue.getByRole('button', {name: 'Cuba semula amaran'}).count(), 0);
 await overdue.getByRole('button', {name: 'Selesaikan tugasan'}).click();
 await overdue.waitFor({state: 'detached'});
 await panel.getByRole('button', {name: 'Selesai', exact: true}).click();
 const history = panel.getByRole('list', {name: 'Tugasan selesai'});
 await history.getByRole('heading', {name: 'Aina'}).waitFor();
 assert.deepEqual(await history.getByRole('button').allTextContents(), ['Buka perbualan']);
 await panel.getByRole('button', {name: 'Terbuka', exact: true}).click();
 await task('chat-old').getByRole('button', {name: 'Buka perbualan'}).click();
 await page.getByRole('main').getByText('Pelanggan lama', {exact: true}).waitFor();
 assert.deepEqual((await calls()).filter(call => call.kind === 'lookup'), [{kind: 'lookup', id: 'chat-old'}]);
 const channel = panel.getByLabel('Saluran amaran baharu');
 await channel.selectOption('whatsapp');
 await panel.getByText('Saluran amaran disimpan.', {exact: true}).waitFor();
 await channel.selectOption('in_app');
 assert.deepEqual((await calls()).filter(call => call.kind === 'channel'), [
   {kind: 'channel', id: 'whatsapp'}, {kind: 'channel', id: 'in_app'},
 ]);
 for (const dark of [false, true]) {
   await page.setViewportSize({width: 375, height: 812});
   await page.evaluate(on => document.documentElement.classList.toggle('dark', on), dark);
   assert.equal(await panel.evaluate(element => element.scrollWidth <= element.clientWidth), true);
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   const contrast = await channel.evaluate(element => {
     const canvas = document.createElement('canvas');
     canvas.width = canvas.height = 1;
     const context = canvas.getContext('2d', {willReadFrequently: true});
     const luminance = color => {
       context.clearRect(0, 0, 1, 1);
       context.fillStyle = color;
       context.fillRect(0, 0, 1, 1);
       const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n / 255)
         .map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
       return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
     };
     const hint = document.getElementById(element.getAttribute('aria-describedby'));
     const levels = [getComputedStyle(hint).color, getComputedStyle(document.body).backgroundColor]
       .map(luminance).sort((a, b) => b - a);
     return (levels[0] + 0.05) / (levels[1] + 0.05);
   });
   assert.ok(contrast >= 4.5, `${dark ? 'Dark' : 'Light'} hint contrast ${contrast}`);
 }
 assert.deepEqual(errors, []);
 console.log('PASS actual handoff UI: task actions and CAS failure, provider states, confirmed retry, keyboard focus, older chat, channel, 375px layout and theme contrast');

 await page.goto('http://127.0.0.1:5175/route.html?handoffReadError&noRecipient');
 await panel.getByRole('status').filter({hasText: 'Memuatkan tugasan'}).waitFor();
 await panel.getByRole('alert').filter({hasText: 'Tugasan gagal dimuatkan'}).waitFor();
 await panel.getByRole('alert').filter({hasText: 'Saluran amaran gagal dimuatkan'}).waitFor();
 await page.evaluate(() => window.handoffHarness.restoreReads());
 await panel.getByRole('button', {name: 'Muat semula tugasan'}).click();
 await panel.getByRole('button', {name: 'Muat semula saluran'}).click();
 await panel.getByText(/Tambah nombor WhatsApp pemilik/).waitFor();
 assert.equal(await channel.getByRole('option', {name: 'WhatsApp'}).isDisabled(), true);
 await channel.selectOption('in_app');
 await panel.getByRole('button', {name: 'Selesai', exact: true}).click();
 await panel.getByText('Tiada tugasan selesai.').waitFor();
 assert.deepEqual(errors, []);
 console.log('PASS actual handoff UI: loading, read error, manual reload, recipient unavailable and empty history');
} finally { await browser.close(); }
