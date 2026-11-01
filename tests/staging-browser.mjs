import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
if (process.env.STAGING_ENV_FILE) process.loadEnvFile(process.env.STAGING_ENV_FILE);
const require=createRequire(new URL('../package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');const {chromium}=require('playwright');
const admin=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const email=`codex-ui-${randomUUID()}@example.invalid`,password=randomBytes(28).toString('base64url');let userId,browser,page;
const ok=(name)=>console.log(`PASS ${name}`);
async function waitDB(query,check){for(let i=0;i<30;i++){const r=await query();if(r.error)throw new Error(r.error.message);if(check(r.data))return r.data;await new Promise(r=>setTimeout(r,500));}throw new Error('Database assertion timed out');}
try{
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{business_name:'Codex staging UI'}});if(created.error)throw created.error;userId=created.data.user.id;
 const insert=await admin.from('chats').insert({business_id:userId,customer_phone:`+60000${Date.now()}`,customer_name:'Codex Test Customer',is_bot_active:false}).select('id').single();if(insert.error)throw insert.error;const chatId=insert.data.id;
 await admin.from('messages').insert({chat_id:chatId,sender:'customer',text:'Codex staging browser test'});
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${process.env.STAGING_APP_URL ?? 'http://127.0.0.1:3000'}/auth`);await page.waitForFunction(()=>{const el=document.getElementById('signin-email');return el&&!el.disabled});await page.getByLabel('Emel',{exact:true}).fill(email);await page.getByLabel('Kata laluan',{exact:true}).fill(password);await page.getByRole('button',{name:'Log Masuk',exact:true}).click();await page.waitForURL('**/dashboard');await page.getByRole('heading',{name:'Prestasi Ejen AI',exact:true}).waitFor();ok('real Supabase login and authenticated dashboard');
 await page.goto(`${process.env.STAGING_APP_URL ?? 'http://127.0.0.1:3000'}/dashboard/inbox`);await page.getByText('Codex Test Customer',{exact:true}).first().click();await page.getByText('Codex staging browser test',{exact:true}).waitFor();
 await page.getByRole('textbox',{name:'Balasan pelanggan'}).fill('Codex manual reply without connection');await page.getByRole('button',{name:'Hantar',exact:true}).click();await page.getByRole('button',{name:'Cuba Semula',exact:true}).waitFor();
 let rows=await waitDB(()=>admin.from('messages').select('id,delivery_status,delivery_attempts').eq('chat_id',chatId).eq('sender','human'),d=>d.length===1&&d[0].delivery_status==='failed');assert.equal(rows[0].delivery_attempts,1);const humanId=rows[0].id;ok('real manual send persists failed status when no WhatsApp connection');
 await page.getByRole('button',{name:'Cuba Semula',exact:true}).click();rows=await waitDB(()=>admin.from('messages').select('id,delivery_status,delivery_attempts').eq('chat_id',chatId).eq('sender','human'),d=>d.length===1&&d[0].delivery_attempts===2);assert.equal(rows[0].id,humanId);assert.equal(rows[0].delivery_status,'failed');ok('real Cuba Semula updates same DB row and increments attempts');
 await page.goto(`${process.env.STAGING_APP_URL ?? 'http://127.0.0.1:3000'}/dashboard/knowledge-base`);await page.getByLabel('Soalan',{exact:true}).fill('Codex test waktu buka?');await page.getByLabel('Jawapan',{exact:true}).fill('Buka 9 pagi untuk ujian staging.');await page.getByRole('button',{name:'Tambah FAQ',exact:true}).click();await waitDB(()=>admin.from('knowledge_base').select('id,content').eq('business_id',userId),d=>d.some(r=>r.content.includes('Codex test waktu buka?')));ok('real FAQ saved through authenticated server function');
 await page.locator('input[type="file"]').setInputFiles({name:'codex-staging.txt',mimeType:'text/plain',buffer:Buffer.from('Codex staging upload. Waktu operasi ialah 9 pagi hingga 6 petang.')});await waitDB(()=>admin.from('kb_documents').select('id,status,status_message').eq('business_id',userId),d=>d.length===1&&d[0].status==='processed');const chunks=await admin.from('knowledge_base').select('id').eq('business_id',userId).not('document_id','is',null);assert.ok(chunks.data?.length>0);ok('real TXT upload, Storage download, extraction and keyword knowledge ingestion');
 await page.goto(`${process.env.STAGING_APP_URL ?? 'http://127.0.0.1:3000'}/dashboard/settings`);await page.getByLabel('Nama Perniagaan',{exact:true}).fill('Codex staging updated');await page.getByRole('button',{name:'Simpan',exact:true}).click();await waitDB(()=>admin.from('profiles').select('business_name').eq('id',userId),d=>d[0]?.business_name==='Codex staging updated');ok('real Settings persisted');
 await page.goto(`${process.env.STAGING_APP_URL ?? 'http://127.0.0.1:3000'}/admin/analytics`);await page.waitForURL('**/dashboard');ok('SME cannot open admin route');
 assert.deepEqual(errors,[]);ok('no browser runtime errors in authenticated flows');
}catch(e){console.log(JSON.stringify({status:'failed',error:e.message?.replace(/https?:\/\/[^\s]+/g,'[url]')}));if(page)await page.screenshot({path:process.env.STAGING_SCREENSHOT_PATH ?? '/tmp/lokalchat-staging-browser-failure.png',fullPage:true}).catch(()=>{});process.exitCode=1;}
finally{
 if(browser)await browser.close();
 if(userId){const listing=await admin.storage.from('kb-documents').list(userId);if(listing.data?.length){const r=await admin.storage.from('kb-documents').remove(listing.data.map(o=>`${userId}/${o.name}`));if(r.error){console.log('FAIL storage cleanup');process.exitCode=1;}}
 for(const table of ['knowledge_base','kb_documents','chats']){const r=await admin.from(table).delete().eq('business_id',userId);if(r.error){console.log('FAIL row cleanup '+table);process.exitCode=1;}}
 const deleted=await admin.auth.admin.deleteUser(userId);if(deleted.error){console.log('FAIL user cleanup');process.exitCode=1;}else console.log('CLEANUP temporary browser user removed');}
}
