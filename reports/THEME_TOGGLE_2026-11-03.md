# LokalChat: global light/dark theme

Implemented in `/home/irsyad_b/lokalchat-open` on 3 November 2026.

## Result

- One shared theme across the landing page, authentication, dashboard, live chat, knowledge base, unanswered questions, business settings and admin analytics. Theme switches appear in the landing header, authentication page, console/admin navigation and settings header.
- First visit follows the operating system. A manual selection persists as `lokalchat-theme` in browser localStorage, survives navigation and reload, and synchronizes across tabs. When storage is unavailable, the switch still works for the current visit.
- The bootstrap runs in the document head before page content. The provider supports server rendering and hydration. React hoists stylesheets ahead of the inline bootstrap; the script still executes before the body.
- The existing teal identity and typography remain. Dark surfaces, chat bubbles, menus, forms, rich toast notifications and logo treatment now follow the theme. The original dark landing artwork remains available in dark mode; light mode uses a faint version behind dark text.
- The control uses a sun/moon sliding disc with 180–220 ms feedback, a 44 px touch target, a named ARIA switch, native keyboard activation and visible keyboard focus. Reduced-motion mode removes the added motion.
- Landing navigation styles are scoped so they do not change the console after client navigation. On narrow screens, console navigation moves above the content; the landing header makes room for the switch.

This is a component change within the existing brand, with no new design draw, font, image or dependency. Existing unrelated working-tree changes were preserved.

## Main files

- `src/lib/theme.ts`: preference storage, system preference, tab synchronization and first-paint bootstrap.
- `src/components/lokalchat/ThemeProvider.tsx` and `ThemeToggle.tsx`: shared React state and accessible control.
- `src/routes/__root.tsx`: document bootstrap and global provider.
- `src/styles/theme.css`, `src/styles/lokalchat.css`, `src/styles/landing.css`, `src/styles.css`: theme-aware surfaces, typography colours, motion and responsive layout.

## Validation

- `npm test`: passed, including the existing document upload, inbox, delivery, configuration, local setup, LLM and Supabase settings suites.
- `npm run test:theme`: 12 tests passed. Covers first-paint preference resolution, persistence, manual override, system changes, tab synchronization, storage removal, denied storage, subscription cleanup and accessible server-rendered controls.
- `npm run typecheck`: passed.
- `npm run build`: passed on the final source. Existing framework deprecation and bundling warnings remain.
- `npm run test:theme:ssr`: passed for `/` and `/auth` against the final production SSR handler, without starting a socket listener. Both return HTTP 200, include the named switch and emit the bootstrap before page content.
- Design lint on the new theme control, provider and theme stylesheet: 0 FAIL, 0 WARN.
- `git diff --check`: passed.
- `graphify update .`: completed using AST extraction; 1,319 nodes, 2,749 edges, 117 communities.

## Browser limitation

Visual screenshots, measured contrast, browser hydration, keyboard interaction and viewport behaviour have not been verified in a real browser. The design inspector could not launch because Chrome/Chromium is absent. A separate socket probe failed with `listen EPERM` in this sandbox. No visual quality scores are claimed.

No deployment, package publication, real database writes or credential changes were performed.
