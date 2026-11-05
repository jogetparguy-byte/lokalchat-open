# Dashboard sidebar collapse

Implemented in `/home/irsyad_b/lokalchat-open` on 3 November 2026.

- A persistent `Navigasi` button above the dashboard content hides or restores the entire sidebar. The content takes the released space. All dashboard routes using `ConsoleShell` share the control.
- `Ctrl+B` and `Meta+B` toggle navigation. macOS displays `⌘B`. The handler ignores input, textarea, select, nested editable content, custom textbox/combobox controls, composition, repeated keydown, already handled events and additional Alt/Shift modifiers.
- The browser remembers the choice under `lokalchat-sidebar-collapsed`. Denied storage does not disable navigation. SSR starts expanded and restores the browser preference after mounting.
- The hidden sidebar receives `inert` and `aria-hidden`; the button exposes `aria-expanded`, `aria-controls` and `aria-keyshortcuts`. Collapsing from a focused sidebar link returns focus to the toggle.
- The theme switch moves into the persistent toolbar so it remains available while navigation is hidden. Existing logo, typography, colors and dashboard data remain the design source; no new style or sample dataset was introduced.
- Desktop sidebar motion uses transform transitions: 180 ms opening and 150 ms closing. The direction indicator rotates in 180 ms. Reduced motion removes movement. Mobile keeps the existing horizontal navigation and folds it immediately; its toggle remains available.

Files: `src/components/lokalchat/ConsoleLayout.tsx`, `ConsoleShell.tsx`, `src/styles/console-navigation.css`, and the import in `src/styles.css`.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, including existing theme, inbox, configuration and delivery suites.
- `npm run build`: passed. Existing TanStack inputValidator, Vite configuration and module directive warnings remain.
- Taste source lint on the new component and stylesheet: 0 failures, 0 warnings.
- `git diff --check`: passed.
- A temporary Happy DOM integration check at `/tmp/lokalchat-sidebar-check/check.mjs` passed eight groups: SSR semantics, clicks/ARIA/storage/theme access, Ctrl/Meta shortcuts, ignored key combinations, editable controls, focus transfer, remount persistence, and listener cleanup/blocked storage. Happy DOM was installed only under `/tmp`; project dependencies did not change. This validates component behavior in a simulated DOM, not rendering or native browser inert/focus behavior.
- Browser screenshots and visual motion/responsive checks could not run: Chrome/Edge/Chromium is unavailable, and a local socket probe returns `EPERM`. No visual score is claimed.
- `graphify update .`: passed using sequential extraction after the sandbox denied parallel extraction.

No deployment, npm publication, database mutation or credential change was performed.
