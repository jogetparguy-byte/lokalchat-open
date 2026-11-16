import assert from "node:assert/strict";
import server from "../.output/server/_ssr/ssr.mjs";

// Run after npm run build. Exercise production SSR without opening a server socket.
const home = await server.fetch(new Request("http://localhost/"), {}, {});
assert.equal(home.status, 307, "/: redirects to authentication");
assert.equal(home.headers.get("location"), "/auth");
assert.ok(!(await home.text()).includes('class="lc-landing"'), "/: no landing page");
console.log("PASS production SSR /: HTTP 307 to /auth, no landing page");

for (const path of ["/auth"]) {
  const response = await server.fetch(new Request(`http://localhost${path}`), {}, {});
  const html = await response.text();
  assert.equal(response.status, 200, `${path}: status`);
  assert.ok(!html.includes('role="switch"'), `${path}: no theme switch in onboarding`);
  const bootstrap = html.indexOf('localStorage.getItem("lokalchat-theme")');
  assert.ok(bootstrap > 0 && bootstrap < html.indexOf("</head>"), `${path}: theme before page content`);
  assert.ok(!html.includes("useTheme must be used inside ThemeProvider"), `${path}: provider context`);
  console.log(`PASS production SSR ${path}: HTTP 200, no theme switch, bootstrap before content`);
}
