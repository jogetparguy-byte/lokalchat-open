export type Language = "ms" | "en";
export type ReplyLanguage = "auto" | Language;
export type DisplayPreferences = {
  language: Language;
  timeZone: string;
  dateFormat: "dmy" | "mdy" | "iso";
};
export const PREFERENCES_KEY = "lokalchat-preferences";
export const SIDEBAR_KEY = "lokalchat-sidebar-collapsed";
export const DEFAULT_PREFERENCES: DisplayPreferences = {
  language: "ms",
  timeZone: "Asia/Kuala_Lumpur",
  dateFormat: "dmy",
};

export function parsePreferences(value: unknown): DisplayPreferences {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  let timeZone = DEFAULT_PREFERENCES.timeZone;
  if (typeof data["timeZone"] === "string") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data["timeZone"] });
      timeZone = data["timeZone"];
    } catch {
      /* Keep a valid default. */
    }
  }
  return {
    language: data["language"] === "en" ? "en" : "ms",
    timeZone,
    dateFormat:
      data["dateFormat"] === "mdy" || data["dateFormat"] === "iso"
        ? data["dateFormat"]
        : "dmy",
  };
}

// These user-editable values are preferences only, never authorization claims.
export function accountPreferences(
  metadata: Record<string, unknown> | undefined,
) {
  return {
    replyLanguage: (metadata?.["lokalchat_reply_language"] === "ms" ||
    metadata?.["lokalchat_reply_language"] === "en"
      ? metadata["lokalchat_reply_language"]
      : "auto") as ReplyLanguage,
    weeklyReport: metadata?.["lokalchat_weekly_report"] !== false,
  };
}

export function replyInstruction(language: ReplyLanguage) {
  if (language === "en") return "Reply to customers in English.";
  if (language === "ms") return "Balas pelanggan dalam Bahasa Melayu.";
  return "Match the language used by the customer, including Malay, English or Manglish.";
}

export function formatDate(
  value: string | number | Date,
  preferences: DisplayPreferences,
  withTime = true,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: preferences.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const }
      : {}),
  }).formatToParts(date);
  const part = (name: string) =>
    parts.find((p) => p.type === name)?.value ?? "";
  const { dateFormat } = preferences;
  const dateText =
    dateFormat === "iso"
      ? `${part("year")}-${part("month")}-${part("day")}`
      : dateFormat === "mdy"
        ? `${part("month")}/${part("day")}/${part("year")}`
        : `${part("day")}/${part("month")}/${part("year")}`;
  return withTime ? `${dateText}, ${part("hour")}:${part("minute")}` : dateText;
}

export function createPreferencesStore(browser: Window) {
  let current = DEFAULT_PREFERENCES;
  const listeners = new Set<() => void>();
  function read() {
    try {
      current = parsePreferences(
        JSON.parse(browser.localStorage.getItem(PREFERENCES_KEY) ?? "null"),
      );
    } catch {
      current = DEFAULT_PREFERENCES;
    }
  }
  read();
  const emit = () => listeners.forEach((listener) => listener());
  function onStorage(event: StorageEvent) {
    if (
      (event.key === PREFERENCES_KEY || event.key === null) &&
      (!event.storageArea || event.storageArea === browser.localStorage)
    ) {
      read();
      emit();
    }
  }
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      if (!listeners.size) {
        read();
        browser.addEventListener("storage", onStorage);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) browser.removeEventListener("storage", onStorage);
      };
    },
    save(value: DisplayPreferences) {
      const next = parsePreferences(value);
      // Report blocked storage; never show a false persistent-save success.
      browser.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      current = next;
      emit();
    },
  };
}

let browserStore: ReturnType<typeof createPreferencesStore> | undefined;
export function getPreferencesStore() {
  if (typeof window === "undefined") return undefined;
  return (browserStore ??= createPreferencesStore(window));
}
