export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "lokalchat-theme";

function parseTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

// Runs in the head before page content and hydration, so first paint uses the saved preference.
export const themeBootstrapScript = `(() => {
  let preference = null;
  try { preference = localStorage.getItem("${THEME_STORAGE_KEY}"); } catch {}
  const dark = preference === "dark" || (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();`;

export function createThemeStore(browser: Window) {
  const media = browser.matchMedia("(prefers-color-scheme: dark)");
  let preference: Theme | null = null;
  try {
    preference = parseTheme(browser.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {}
  const resolve = (): Theme => preference ?? (media.matches ? "dark" : "light");
  let theme = resolve();
  const listeners = new Set<() => void>();

  function apply() {
    theme = resolve();
    const root = browser.document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset["theme"] = theme;
    root.style.colorScheme = theme;
    listeners.forEach((listener) => listener());
  }

  function onSystemChange() {
    if (preference === null) apply();
  }

  function onStorage(event: StorageEvent) {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    // Ignore sessionStorage events with the same key.
    try {
      if (event.storageArea && event.storageArea !== browser.localStorage)
        return;
    } catch {}
    preference = parseTheme(event.key === null ? null : event.newValue);
    apply();
  }

  return {
    getSnapshot: () => theme,
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        media.addEventListener("change", onSystemChange);
        browser.addEventListener("storage", onStorage);
        apply();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          media.removeEventListener("change", onSystemChange);
          browser.removeEventListener("storage", onStorage);
        }
      };
    },
    setTheme(next: Theme) {
      preference = next;
      // Storage can be unavailable in private or restricted browsers. The toggle still works.
      try {
        browser.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {}
      apply();
    },
  };
}
