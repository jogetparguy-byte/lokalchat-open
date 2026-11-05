// Only the server boundary is mocked; the production route, query hooks and UI run unchanged.
const chats = ['a', 'b'].map(id => ({id: `chat-${id}`, customer_name: id === 'a' ? 'Aina' : 'Badrul', customer_phone: '+60123456789', is_bot_active: false, last_message: null, updated_at: '2026-10-24'}));
const row = (chat: string) => ({id: `message-${chat}`, chat_id: `chat-${chat}`, sender: 'human', text: `Balasan ${chat}`, created_at: '2026-10-24', delivery_status: 'failed', last_delivery_error: 'token=SECRET_TEST', sent_at: null, delivery_attempts: 1});
const messages = { 'chat-a': [row('a')], 'chat-b': [row('b')] };
const calls: {kind: string; id: string}[] = [];
let complete: ((outcome: string) => void) | null = null;
function record(kind: string, id: string) { calls.push({kind, id}); }
export const useApi = <T,>(fn: T): T => fn;
export async function listChats() { return structuredClone(chats); }
export async function listMessages({data}: {data: {chatId: keyof typeof messages}}) { record('list', data.chatId); return structuredClone(messages[data.chatId]); }
export async function retryFailedHumanReply({data}: {data: {messageId: string}}) {
 record('retry', data.messageId);
 const message = Object.values(messages).flat().find(row => row.id === data.messageId)!;
 message.delivery_status = 'sending';
 await new Promise<void>((resolve, reject) => { complete = outcome => {
   complete = null; message.delivery_status = outcome === 'sent' ? 'sent' : 'failed'; message.delivery_attempts++;
   if (outcome === 'sent') resolve(); else reject(new Error('token=SECRET_TEST'));
 }; });
 return {ok: true, messageId: message.id, deliveryStatus: 'sent'};
}
export async function setBotActive() { return {ok: true}; }
export async function sendHumanReply() { throw new Error('Unexpected sendHumanReply during retry'); }
export async function simulateIncoming() { return {ok: true}; }
Object.assign(window, { routeHarness: { calls, finish: (outcome: string) => complete?.(outcome) } });

// Settings harness: render the actual page; mock only authenticated server functions.
const profile = { business_name: 'Kedai Aina', inventory_api_url: '', owner_whatsapp: '' };
export async function getProfile() { return {...profile}; }
export async function updateProfile({data}: {data: {businessName?: string; inventoryApiUrl?: string; ownerWhatsapp?: string}}) {
  if (data.businessName !== undefined) profile.business_name = data.businessName;
  if (data.inventoryApiUrl !== undefined) profile.inventory_api_url = data.inventoryApiUrl;
  if (data.ownerWhatsapp !== undefined) profile.owner_whatsapp = data.ownerWhatsapp;
  return {ok: true};
}
export async function getWhatsappConnection() { return null; }
export async function saveWhatsappConnection() { return {ok: true}; }
const params = new URLSearchParams(window.location.search);
let settings = { canManage: true as const, provider: 'gemini' as 'gemini' | 'deepseek' | 'openai' | 'custom', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: '', hasApiKey: false, active: false };
const settingsCalls: unknown[] = [];
let finishSave: ((fail: boolean) => void) | null = null;
export async function getLlmSettings() {
  if (params.has('readError')) throw new Error('read failure');
  return {...settings};
}
export async function saveLlmSettings({data}: {data: {provider: typeof settings.provider; baseUrl: string; model: string; apiKey: string}}) {
  settingsCalls.push({...data});
  await new Promise<void>((resolve, reject) => {
    finishSave = fail => { finishSave = null; if (fail) reject(new Error('backend failure')); else resolve(); };
  });
  settings = {...settings, provider: data.provider, baseUrl: data.baseUrl, model: data.model, hasApiKey: true, active: true};
  return {...settings};
}
Object.assign(window, { settingsHarness: { calls: settingsCalls, finish: (fail = false) => finishSave?.(fail) } });

let supabaseSettings = { canManage: true as const, projectUrl: 'https://fixture.supabase.co', hasPublicKey: false, hasSecretKey: false, requiresRestart: false };
const supabaseCalls: unknown[] = [];
let finishSupabaseSave: ((fail: boolean) => void) | null = null;
export async function getSupabaseSettings() {
  if (params.has('readError')) throw new Error('read failure');
  return {...supabaseSettings};
}
export async function saveSupabaseSettings({data}: {data: {projectUrl: string; publicKey: string; secretKey: string}}) {
  supabaseCalls.push({...data});
  await new Promise<void>((resolve, reject) => { finishSupabaseSave = fail => { finishSupabaseSave = null; if (fail) reject(new Error('backend failure')); else resolve(); }; });
  supabaseSettings = {...supabaseSettings, projectUrl: data.projectUrl, hasPublicKey: true, hasSecretKey: true, requiresRestart: true};
  return {...supabaseSettings};
}
Object.assign(window, { supabaseHarness: {calls: supabaseCalls, finish: (fail = false) => finishSupabaseSave?.(fail)} });
