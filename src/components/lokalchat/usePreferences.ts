import { translations } from "@/lib/translations";
import { useEffect, useSyncExternalStore } from "react";
import {
  getPreferencesStore,
  DEFAULT_PREFERENCES,
  formatDate,
  type DisplayPreferences,
} from "@/lib/preferences";

const serverSnapshot = () => DEFAULT_PREFERENCES;
const serverSubscribe = () => () => {};

export function usePreferences() {
  const store = getPreferencesStore();
  const preferences = useSyncExternalStore(
    store?.subscribe ?? serverSubscribe,
    store?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  );
  const t = (ms: string, en: string) =>
    preferences.language === "en" ? en : ms;
  useEffect(() => {
    document.documentElement.lang = preferences.language;
  }, [preferences.language]);
  return {
    preferences,
    t,
    translate: (text: string) =>
      preferences.language === "en" ? (translations[text] ?? text) : text,
    savePreferences: (next: DisplayPreferences) => store?.save(next),
    formatDate: (value: string | number | Date, withTime = true) =>
      formatDate(value, preferences, withTime),
  };
}
