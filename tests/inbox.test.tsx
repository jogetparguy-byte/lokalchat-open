import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatWindow, type MessageRow } from "../src/components/dashboard/ChatWindow";

const chat = { id: "chat-1", customer_name: "Aina", customer_phone: "+60123456789", is_bot_active: false, last_message: null, updated_at: "2026-10-24T00:00:00Z" };
const message = (sender: MessageRow["sender"], status: MessageRow["delivery_status"]): MessageRow => ({ id: `${sender}-${status}`, chat_id: chat.id, sender, text: "Test reply", created_at: "2026-10-24T00:00:00Z", delivery_status: status, last_delivery_error: status === "failed" ? "Provider unavailable" : null, delivery_attempts: 2, sent_at: null });
function render(messages: MessageRow[], retryingId: string | null = null) {
  return renderToStaticMarkup(<ChatWindow chat={chat} messages={messages} sending={false} toggling={false} retryingId={retryingId} loading={false} onToggleBot={() => {}} onSend={async () => {}} onRetry={() => {}} />);
}

test("outbound delivery labels distinguish Meta acceptance from customer receipt", () => {
  const html = render([message("bot", "pending"), message("human", "sending"), message("human", "sent"), message("bot", "failed")]);
  for (const label of ["Menunggu penghantaran", "Sedang dihantar", "Diterima Meta", "Penghantaran gagal", "Belum mengesahkan diterima atau dibaca pelanggan."]) assert.ok(html.includes(label), label);
  assert.ok(!html.includes("Provider unavailable"));
});

test("only failed human replies expose Cuba Semula", () => {
  assert.ok(render([message("human", "failed")]).includes(">Cuba Semula</button>"));
  for (const row of [message("bot", "failed"), message("human", "sent"), message("human", "pending"), message("human", "sending"), message("human", null)]) assert.ok(!render([row]).includes(">Cuba Semula</button>"), `${row.sender} ${row.delivery_status}`);
});

test("customer and system rows never expose outbound status or provider errors", () => {
  const html = render([message("customer", "failed"), message("system", "failed")]);
  assert.ok(!html.includes("Penghantaran gagal"));
  assert.ok(!html.includes("Provider unavailable"));
  assert.ok(!html.includes(">Cuba Semula</button>"));
});

test("in-flight retry disables the retry control", () => {
  const html = render([message("human", "failed")], "human-failed");
  assert.match(html, /<button[^>]*disabled=""[^>]*>Mencuba semula…<\/button>/);
});

test("stored provider error renders as escaped text", () => {
  const row = message("human", "failed");
  row.last_delivery_error = '<script>alert("x")</script>';
  const html = render([row]);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes("&lt;script&gt;"));
});
