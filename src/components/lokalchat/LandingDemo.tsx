import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, CornerDownLeft, RotateCcw } from "lucide-react";

type DemoMessage = { sender: "customer" | "bot" | "human"; text: string; language?: "ms" };

// Fictional shop data keeps this public demo independent of customer records and paid APIs.
const SCENARIOS: { title: string; summary: string; knowledge: string; messages: DemoMessage[]; handedOff: boolean }[] = [
  {
    title: "The everyday questions",
    summary: "Your shipping policy, in their language.",
    knowledge: "Orders placed before 2 pm, Monday to Friday, are shipped on the same working day.",
    messages: [
      { sender: "customer", text: "Hi boss, order pagi ni bila pos?", language: "ms" },
      { sender: "bot", text: "Hi! Kalau order sebelum 2 petang pada hari bekerja, kami pos hari yang sama ya.", language: "ms" },
      { sender: "customer", text: "Nice, sempat lah. Thanks!", language: "ms" },
    ],
    handedOff: false,
  },
  {
    title: "A quick stock check",
    summary: "An answer from your connected inventory.",
    knowledge: "Example inventory: Everyday Tote, forest green, 8 available. Live stock checks require your shop’s inventory API.",
    messages: [
      { sender: "customer", text: "Everyday Tote warna green ada stock lagi?", language: "ms" },
      { sender: "bot", text: "Ada! Everyday Tote warna forest green ada 8 lagi dalam stok sekarang, boss.", language: "ms" },
      { sender: "customer", text: "Okay, nak satu!", language: "ms" },
    ],
    handedOff: false,
  },
  {
    title: "When they need you",
    summary: "The bot steps aside. You take it from here.",
    knowledge: "When a customer asks for a person, LokalChat hands over the conversation and pauses the bot.",
    messages: [
      { sender: "customer", text: "Can I talk to the owner about a bulk order?" },
      { sender: "bot", text: "Of course. I’ll connect you with the owner now." },
    ],
    handedOff: true,
  },
];

export function LandingDemo() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [manualTakeover, setManualTakeover] = useState(false);
  const [replies, setReplies] = useState<DemoMessage[]>([]);
  const [draft, setDraft] = useState("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const scenario = SCENARIOS[scenarioIndex]!;
  const ownerActive = scenario.handedOff || manualTakeover;

  useEffect(() => {
    const container = messagesRef.current;
    if (container && replies.length > 0) container.scrollTop = container.scrollHeight;
  }, [replies.length]);

  function selectScenario(index: number) {
    setScenarioIndex(index);
    setManualTakeover(false);
    setReplies([]);
    setDraft("");
  }

  function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!ownerActive || !text || text.length > 500) return;
    setReplies((previous) => [...previous, { sender: "human", text }]);
    setDraft("");
  }

  return (
    <div className="lc-demo" data-ui>
      <div className="lc-demo-controls">
        <p className="lc-demo-label">A little taste of LokalChat</p>
        <div className="lc-scenarios" role="group" aria-label="Example conversations">
          {SCENARIOS.map((item, index) => (
            <button type="button" key={item.title} className="lc-scenario" aria-pressed={scenarioIndex === index} aria-controls="demo-conversation" onClick={() => selectScenario(index)}>
              <span><strong>{item.title}</strong><span>{item.summary}</span></span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="lc-demo-knowledge"><p>What the shop knows</p><p>{scenario.knowledge}</p></div>
        <p className="lc-demo-disclaimer">Illustrative demo with sample shop data. No WhatsApp messages are sent.</p>
      </div>
      <div className="lc-conversation" id="demo-conversation" role="region" aria-label="Sample shop conversation">
        <div className="lc-conversation-header">
          <div className="lc-shop-identity"><span className="lc-shop-avatar" aria-hidden="true">K</span><div><strong>Kedai Kita</strong><span>Example shop</span></div></div>
          <span className="lc-agent-state">{ownerActive ? "Owner in control" : "LokalChat is replying"}</span>
        </div>
        <div ref={messagesRef} className="lc-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation messages" tabIndex={0}>
          <p className="lc-conversation-date">An everyday conversation</p>
          {[...scenario.messages, ...replies].map((message, index) => (
            <div className={`lc-message lc-message-${message.sender}`} key={`${scenarioIndex}-${index}`}>
              <span className="lc-message-name">{message.sender === "customer" ? "Customer" : message.sender === "bot" ? "LokalChat" : "You"}</span>
              <p lang={message.language}>{message.text}</p>
              {message.sender !== "customer" && <Check size={13} aria-label="Shown in demo" />}
            </div>
          ))}
          {ownerActive && <p className="lc-handoff-notice"><Check size={14} aria-hidden="true" /> Bot paused. This conversation is yours.</p>}
        </div>
        <div className="lc-demo-reply">
          {ownerActive ? (
            <form onSubmit={sendReply}>
              <label className="sr-only" htmlFor="demo-owner-reply">Your reply as the owner</label>
              <input id="demo-owner-reply" placeholder="Reply as the owner…" maxLength={500} value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
              <button type="submit" aria-label="Send demo reply" disabled={!draft.trim()}><CornerDownLeft size={19} aria-hidden="true" /></button>
            </form>
          ) : (
            <div className="lc-takeover-row"><span>You’re always in control.</span><button type="button" onClick={() => setManualTakeover(true)}>Take over <ArrowUpRight size={15} aria-hidden="true" /></button></div>
          )}
          <button className="lc-demo-reset" type="button" onClick={() => selectScenario(scenarioIndex)}><RotateCcw size={13} aria-hidden="true" /> Reset example</button>
        </div>
      </div>
    </div>
  );
}
