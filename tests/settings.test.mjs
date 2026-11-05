import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { validateProfilePatch } from "../src/lib/profile-settings.ts";
import {
  accountPreferences,
  replyInstruction,
  createPreferencesStore,
  formatDate,
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
} from "../src/lib/preferences.ts";

function browserFixture() {
  const values = new Map(),
    listeners = new Set();
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return {
    localStorage,
    values,
    listeners,
    addEventListener: (_event, fn) => listeners.add(fn),
    removeEventListener: (_event, fn) => listeners.delete(fn),
  };
}
test("independent panel payloads preserve fields belonging to other settings", () => {
  assert.deepEqual(validateProfilePatch({ businessName: " Kedai Aina " }), {
    business_name: "Kedai Aina",
  });
  assert.deepEqual(validateProfilePatch({ inventoryApiUrl: "" }), {
    inventory_api_url: null,
  });
  assert.deepEqual(validateProfilePatch({ ownerWhatsapp: "+60 12-3456789" }), {
    owner_whatsapp: "60123456789",
  });
  assert.deepEqual(validateProfilePatch({ ownerWhatsapp: "" }), {
    owner_whatsapp: null,
  });
  for (const data of [
    {},
    null,
    { businessName: "" },
    { businessName: "a".repeat(101) },
    { ownerWhatsapp: "not-a-number" },
    { inventoryApiUrl: "file:///etc/passwd" },
  ])
    assert.throws(() => validateProfilePatch(data));
});
test("browser preferences persist, synchronize tabs, recover corrupt data and release listeners", () => {
  const browser = browserFixture();
  const store = createPreferencesStore(browser);
  let updates = 0;
  const stop = store.subscribe(() => updates++);
  store.save({ language: "en", timeZone: "UTC", dateFormat: "iso" });
  assert.equal(JSON.parse(browser.values.get(PREFERENCES_KEY)).language, "en");
  assert.equal(updates, 1);
  browser.values.set(PREFERENCES_KEY, "{broken");
  for (const listener of browser.listeners)
    listener({ key: PREFERENCES_KEY, storageArea: browser.localStorage });
  assert.deepEqual(store.getSnapshot(), DEFAULT_PREFERENCES);
  stop();
  assert.equal(browser.listeners.size, 0);
});
test("blocked browser storage reports failure without changing saved preference", () => {
  const browser = browserFixture();
  const store = createPreferencesStore(browser);
  browser.localStorage.setItem = () => {
    throw Error("denied");
  };
  assert.throws(() =>
    store.save({ language: "en", timeZone: "UTC", dateFormat: "iso" }),
  );
  assert.equal(store.getSnapshot().language, "ms");
});
test("saved region formats real timestamps and handles invalid dates", () => {
  assert.equal(
    formatDate("2026-11-03T01:30:00Z", DEFAULT_PREFERENCES),
    "03/11/2026, 09:30",
  );
  assert.equal(
    formatDate("2026-11-03T01:30:00Z", {
      language: "en",
      timeZone: "UTC",
      dateFormat: "iso",
    }),
    "2026-11-03, 01:30",
  );
  assert.equal(
    formatDate(
      "2026-11-03T01:30:00Z",
      { language: "en", timeZone: "UTC", dateFormat: "mdy" },
      false,
    ),
    "11/03/2026",
  );
  assert.equal(formatDate("broken", DEFAULT_PREFERENCES), "—");
});
test("account metadata accepts only defined reply languages and explicit report opt-out", () => {
  assert.deepEqual(accountPreferences(undefined), {
    replyLanguage: "auto",
    weeklyReport: true,
  });
  assert.deepEqual(
    accountPreferences({
      lokalchat_reply_language: "en",
      lokalchat_weekly_report: false,
    }),
    { replyLanguage: "en", weeklyReport: false },
  );
  assert.equal(
    accountPreferences({
      lokalchat_reply_language: "injected instructions",
      lokalchat_weekly_report: "false",
    }).replyLanguage,
    "auto",
  );
  assert.match(replyInstruction("ms"), /Bahasa Melayu/);
  assert.match(replyInstruction("en"), /English/);
  assert.match(replyInstruction("auto"), /customer/);
});

function load(relative, dependencies, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name in dependencies) return dependencies[name];
      throw Error(`Unexpected import ${name}`);
    },
    console,
    URL,
    Date,
    Buffer,
    Response,
    AbortSignal,
    ...globals,
  });
  return module.exports;
}
test("profile server saves only submitted fields, checks tenant and rejects private inventory endpoints", async () => {
  const writes = [];
  let blocked = false;
  const context = {
    userId: "owner-a",
    supabase: {
      from(table) {
        assert.equal(table, "profiles");
        return {
          update(patch) {
            writes.push(patch);
            return this;
          },
          eq(column, value) {
            assert.equal(column, "id");
            assert.equal(value, "owner-a");
            return this;
          },
          async select() {
            return { data: [{ id: "owner-a" }], error: null };
          },
        };
      },
    },
  };
  function createServerFn() {
    let validate = (x) => x;
    return {
      middleware() {
        return this;
      },
      inputValidator(fn) {
        validate = fn;
        return this;
      },
      handler(fn) {
        return (input) => fn({ context, data: validate(input?.data) });
      },
    };
  }
  const api = load("../src/lib/lokalchat.functions.ts", {
    "@tanstack/react-start": { createServerFn },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "./metrics": {},
    "./delivery-error": {},
    "./profile-settings": { validateProfilePatch },
    "./ssrf.server": {
      async assertPublicHttpUrl() {
        if (blocked) throw Error("Private endpoint denied");
      },
    },
  });
  await api.updateProfile({ data: { businessName: "Kedai Baharu" } });
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [
    { business_name: "Kedai Baharu" },
  ]);
  blocked = true;
  await assert.rejects(
    api.updateProfile({ data: { inventoryApiUrl: "http://127.0.0.1" } }),
    /Private endpoint/,
  );
  assert.equal(writes.length, 1);
});
test("weekly report hook honors opt-out, skips unreadable preferences and continues other accounts", async () => {
  const sent = [];
  const profiles = ["off", "unavailable", "on"].map((id) => ({
    id,
    business_name: id,
    owner_whatsapp: "60123456789",
    weekly_report_sent_at: null,
  }));
  const admin = {
    auth: {
      admin: {
        async getUserById(id) {
          return id === "unavailable"
            ? { data: {}, error: Error("offline") }
            : {
                data: {
                  user: {
                    user_metadata: { lokalchat_weekly_report: id !== "off" },
                  },
                },
                error: null,
              };
        },
      },
    },
    from(table) {
      const builder = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        not() {
          return this;
        },
        gte() {
          return this;
        },
        limit() {
          return this;
        },
        update() {
          return this;
        },
        async maybeSingle() {
          return { data: { value: "fixture-report-token" }, error: null };
        },
        then(resolve) {
          return Promise.resolve({
            data: table === "profiles" ? profiles : [],
            error: null,
          }).then(resolve);
        },
      };
      return builder;
    },
  };
  const { Route } = load("../src/routes/api/public/hooks/weekly-report.ts", {
    "@/lib/preferences": { accountPreferences },
    "@tanstack/react-router": { createFileRoute: () => (options) => options },
    crypto: { timingSafeEqual: (a, b) => a.equals(b) },
    "@/lib/metrics": {
      summarize: () => ({
        totalMessages: 1,
        autoAnswered: 1,
        savedMs: 1000,
        handoffRate: 0,
      }),
    },
    "@/integrations/supabase/client.server": { supabaseAdmin: admin },
    "@/lib/whatsapp.server": {
      async sendWhatsAppMessage(_number, _text, id) {
        sent.push(id);
        return { ok: true };
      },
    },
  });
  const request = new Request(
    "https://app.test/api/public/hooks/weekly-report",
    { method: "POST", headers: { "x-report-token": "fixture-report-token" } },
  );
  const response = await Route.server.handlers.POST({ request });
  assert.equal(response.status, 200);
  assert.deepEqual(sent, ["on"]);
  assert.equal((await response.json()).sent, 1);
});

test("agent applies the saved account reply language to the real gateway prompt", async () => {
  for (const language of ["en", "ms", "auto"]) {
    const prompts = [];
    const admin = {
      auth: {
        admin: {
          async getUserById(id) {
            assert.equal(id, "owner-a");
            return {
              data: {
                user: { user_metadata: { lokalchat_reply_language: language } },
              },
              error: null,
            };
          },
        },
      },
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          update() {
            return this;
          },
          insert() {
            return this;
          },
          async maybeSingle() {
            return { data: { business_id: "owner-a" }, error: null };
          },
          async single() {
            return { data: { id: "bot-a" }, error: null };
          },
          then(resolve) {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
      },
    };
    const { runAgent } = load(
      "../src/lib/agent.server.ts",
      {
        "@/integrations/supabase/client.server": { supabaseAdmin: admin },
        "./preferences": { accountPreferences, replyInstruction },
        "./embeddings.server": {},
        "./whatsapp.server": {},
        "./platform-key.server": {
          async getActiveLlmConfig(ownerId) {
            assert.equal(ownerId, "owner-a");
            return {
              apiKey: "fixture-key",
              model: "fixture-chat",
              baseUrl: "https://fixture.test",
            };
          },
        },
        "./llm-settings": {
          LLM_PROVIDERS: { fixture: { baseUrl: "https://fixture.test" } },
        },
      },
      {
        fetch: async (_url, init) => {
          prompts.push(JSON.parse(init.body));
          return {
            status: 200,
            ok: true,
            async json() {
              return {
                choices: [
                  { message: { role: "assistant", content: "Fixture reply" } },
                ],
              };
            },
          };
        },
      },
    );
    const result = await runAgent({
      chatId: "chat-a",
      customerPhone: "60123456789",
      userMessage: "Hello",
    });
    assert.equal(result.reply, "Fixture reply");
    assert.ok(
      prompts[0].messages[0].content.endsWith(replyInstruction(language)),
    );
  }
});
