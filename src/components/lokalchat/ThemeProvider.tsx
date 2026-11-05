import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createThemeStore, type Theme } from "@/lib/theme";

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
} | null>(null);
const serverSnapshot = (): Theme => "light";
const serverSubscribe = () => () => {};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    typeof window === "undefined" ? null : createThemeStore(window),
  );
  const theme = useSyncExternalStore(
    store?.subscribe ?? serverSubscribe,
    store?.getSnapshot ?? serverSnapshot,
    serverSnapshot,
  );

  function toggleTheme() {
    if (store)
      store.setTheme(store.getSnapshot() === "dark" ? "light" : "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: (next) => store?.setTheme(next) }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
