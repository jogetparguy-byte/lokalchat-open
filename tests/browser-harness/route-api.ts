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
