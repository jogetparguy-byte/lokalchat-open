import { usePreferences } from "./usePreferences";
import { ThemeToggle } from "@/components/lokalchat/ThemeToggle";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "lokalchat-sidebar-collapsed";

export function ConsoleLayout({
  sidebar,
  children,
}: {
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const { t, preferences } = usePreferences();
  const [collapsed, setCollapsed] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl+B");
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
    if (/Mac|iPhone|iPad/.test(window.navigator.platform)) setShortcut("⌘B");
  }, []);

  useEffect(() => {
    const update = () => { try { setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true"); } catch {} };
    window.addEventListener("lokalchat-sidebar-change", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("lokalchat-sidebar-change", update); window.removeEventListener("storage", update); };
  }, []);

  const toggle = useCallback(() => {
    if (sidebarRef.current?.contains(document.activeElement))
      toggleRef.current?.focus();
    setCollapsed((current) => !current);
  }, []);

  // Write only after a deliberate toggle, so hydration never overwrites a saved preference.
  const toggleAndSave = useCallback(() => {
    toggle();
    try {
      window.localStorage.setItem(STORAGE_KEY, String(!collapsed));
    } catch {
      // The current visit still supports toggling without persistence.
    }
  }, [collapsed, toggle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "b"
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
        )
      )
        return;
      event.preventDefault();
      toggleAndSave();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAndSave]);

  const action = collapsed ? t("Buka navigasi", "Open navigation") : t("Sembunyikan navigasi", "Hide navigation");

  return (
    <div className="lc-app lc-console" data-sidebar-collapsed={collapsed}>
      <div className="lc-sidebar-slot">
        <aside
          id="console-navigation"
          className="lc-sidebar"
          ref={sidebarRef}
          inert={collapsed}
          aria-hidden={collapsed}
          aria-label={t("Navigasi utama", "Main navigation")}
        >
          {sidebar}
        </aside>
      </div>
      <div className="lc-workspace">
        <header className="lc-console-toolbar">
          <button
            ref={toggleRef}
            type="button"
            className="lc-sidebar-toggle"
            onClick={toggleAndSave}
            aria-label={action}
            aria-expanded={!collapsed}
            aria-controls="console-navigation"
            aria-keyshortcuts="Control+b Meta+b"
            title={`${action} (${shortcut})`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <path d="M9 4v16" />
              <path className="lc-sidebar-toggle-arrow" d="m15 9-3 3 3 3" />
            </svg>
            <span>{t("Navigasi", "Navigation")}</span>
            <kbd aria-hidden="true">{shortcut}</kbd>
          </button>
          <ThemeToggle lang={preferences.language} />
        </header>
        <main className="lc-main">{children}</main>
      </div>
    </div>
  );
}
