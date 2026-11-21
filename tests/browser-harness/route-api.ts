// Only the server boundary is mocked; the production route, query hooks and UI run unchanged.
const chats = ['a', 'b'].map(id => ({id: `chat-${id}`, customer_name: id === 'a' ? 'Aina' : 'Badrul', customer_phone: '+60123456789', is_bot_active: false, last_message: null, updated_at: '2026-10-24'}));
const row = (chat: string) => ({id: `message-${chat}`, chat_id: `chat-${chat}`, sender: 'human', text: `Balasan ${chat}`, created_at: '2026-10-24', delivery_status: 'failed', last_delivery_error: 'token=SECRET_TEST', sent_at: null, delivery_attempts: 1});
const messages = { 'chat-a': [row('a')], 'chat-b': [row('b')] };
const olderChat = {...chats[0], id: 'chat-old', customer_name: 'Pelanggan lama'};
const calls: {kind: string; id: string}[] = [];
let complete: ((outcome: string) => void) | null = null;
function record(kind: string, id: string) { calls.push({kind, id}); }
export const useApi = <T,>(fn: T): T => fn;
export async function listChats() { return structuredClone(chats); }
export async function listMessages({data}: {data: {chatId: keyof typeof messages}}) { record('list', data.chatId); return structuredClone(messages[data.chatId] ?? []); }
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
const created = '2026-01-01T00:00:00Z';
const due = '2026-01-01T00:15:00Z';
const taskNotice = (id: string, stage: string, status: string, lastError: string | null = null) => ({
  id, stage, status, attempts: 1, channel: "whatsapp", last_error: lastError, provider_delivery_status: null,
});
const handoffTasks = [
  {id: "task-a", chat_id: "chat-a", status: "pending", created_at: created, due_at: due, accepted_at: null as string | null, resolved_at: null as string | null,
    notifications: [taskNotice("notice-uncertain", "initial", "uncertain"), taskNotice("notice-failed", "escalation", "failed", "token=SECRET_TEST")]},
  {id: "task-b", chat_id: "chat-b", status: "accepted", created_at: created, due_at: due, accepted_at: due, resolved_at: null,
    notifications: [taskNotice("notice-accepted", "initial", "accepted")]},
  {id: "task-old", chat_id: "chat-old", status: "pending", created_at: created, due_at: new Date(Date.now() + 3_600_000).toISOString(),
    accepted_at: null, resolved_at: null, notifications: []},
];
let handoffChannel = params.has("noRecipient") ? "whatsapp" : "in_app";
let handoffReadsFail = params.has("handoffReadError");
let taskTransitionFails = true;
export async function listHandoffTasks({data}: {data: {resolved: boolean}}) {
  if (handoffReadsFail) throw new Error("Private backend details");
  return structuredClone(handoffTasks.filter(task => (task.status === "resolved") === data.resolved));
}
export async function getHandoffSettings() {
  if (handoffReadsFail) throw new Error("Private backend details");
  return {handoff_notification_channel: handoffChannel, owner_whatsapp: params.has("noRecipient") ? null : "+60123456780"};
}
export async function getHandoffChat({data}: {data: {chatId: string}}) {
  record("lookup", data.chatId);
  return data.chatId === olderChat.id ? {...olderChat} : null;
}
export async function setHandoffChannel({data}: {data: {channel: string}}) {
  record("channel", data.channel);
  handoffChannel = data.channel;
  return {ok: true};
}
export async function transitionHandoffTask({data}: {data: {taskId: string; expectedStatus: string; status: string}}) {
  record("transition", [data.taskId, data.expectedStatus, data.status].join(":"));
  const task = handoffTasks.find(row => row.id === data.taskId);
  if (!task || task.status !== data.expectedStatus || taskTransitionFails) {
    taskTransitionFails = false;
    throw new Error("Stale status");
  }
  task.status = data.status;
  if (data.status === "accepted") task.accepted_at = new Date().toISOString();
  else task.resolved_at = new Date().toISOString();
  return {ok: true};
}
export async function retryHandoffNotification({data}: {data: {notificationId: string}}) {
  record("handoff-retry", data.notificationId);
  const notice = handoffTasks.flatMap(task => task.notifications).find(notification => notification.id === data.notificationId)!;
  notice.status = "pending";
  return {ok: true};
}
Object.assign(window, { handoffHarness: { restoreReads: () => { handoffReadsFail = false; } } });
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
