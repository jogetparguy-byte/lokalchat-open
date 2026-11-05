import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/lokalchat/ThemeProvider";

export function ThemeToggle({ lang = "ms" }: { lang?: "ms" | "en" }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-label={lang === "en" ? "Dark theme" : "Tema gelap"}
      aria-checked={dark}
      title={
        lang === "en"
          ? dark
            ? "Switch to light theme"
            : "Switch to dark theme"
          : dark
            ? "Tukar ke tema cerah"
            : "Tukar ke tema gelap"
      }
      className="lc-theme-toggle"
      onClick={toggleTheme}
    >
      <span className="lc-theme-track" aria-hidden="true">
        <span className="lc-theme-thumb" />
        <Sun className="lc-theme-sun" size={16} strokeWidth={1.7} />
        <Moon className="lc-theme-moon" size={16} strokeWidth={1.7} />
      </span>
    </button>
  );
}
