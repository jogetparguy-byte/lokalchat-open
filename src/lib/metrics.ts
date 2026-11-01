/** Shared session-based metrics (dashboard + weekly report). */
export const SESSION_GAP_MS = 60 * 60 * 1000; // 1 jam idle = sesi baharu

export type MsgRow = { chat_id: string; created_at: string };
export type HandoffRow = {
  chat_id: string;
  created_at: string;
  ai_reason: string | null;
  ai_suggested_action: string | null;
};

type Session = { chatId: string; start: number; end: number; messages: number };

function buildSessions(messages: MsgRow[]): Session[] {
  const byChat = new Map<string, number[]>();
  for (const m of messages) {
    const list = byChat.get(m.chat_id) ?? [];
    list.push(new Date(m.created_at).getTime());
    byChat.set(m.chat_id, list);
  }

  const sessions: Session[] = [];
  for (const [chatId, stamps] of byChat) {
    stamps.sort((a, b) => a - b);
    let current: Session | null = null;
    for (const ts of stamps) {
      if (!current || ts - current.end > SESSION_GAP_MS) {
        current = { chatId, start: ts, end: ts, messages: 1 };
        sessions.push(current);
      } else {
        current.end = ts;
        current.messages += 1;
      }
    }
  }
  return sessions;
}

export function summarize(messages: MsgRow[], handoffs: HandoffRow[]) {
  const sessions = buildSessions(messages);
  const handoffsByChat = new Map<string, number[]>();
  for (const h of handoffs) {
    const list = handoffsByChat.get(h.chat_id) ?? [];
    list.push(new Date(h.created_at).getTime());
    handoffsByChat.set(h.chat_id, list);
  }

  let autoAnswered = 0;
  let savedMs = 0;
  let handoffSessions = 0;

  for (const session of sessions) {
    const stamps = handoffsByChat.get(session.chatId) ?? [];
    const hasHandoff = stamps.some(
      (ts) => ts >= session.start && ts <= session.end + SESSION_GAP_MS,
    );
    if (hasHandoff) {
      handoffSessions += 1;
    } else {
      autoAnswered += session.messages;
      savedMs += session.end - session.start;
    }
  }

  return {
    totalMessages: messages.length,
    totalSessions: sessions.length,
    autoAnswered,
    savedMs,
    handoffSessions,
    handoffRate: sessions.length ? (handoffSessions / sessions.length) * 100 : 0,
  };
}

