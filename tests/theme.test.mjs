import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  createThemeStore,
  THEME_STORAGE_KEY,
  themeBootstrapScript,
} from "../src/lib/theme.ts";
import { ThemeProvider } from "../src/components/lokalchat/ThemeProvider.tsx";
import { ThemeToggle } from "../src/components/lokalchat/ThemeToggle.tsx";

function browserFixture({
  preference = null,
  dark = false,
  blocked = false,
} = {}) {
  const values = new Map(
    preference === null ? [] : [[THEME_STORAGE_KEY, preference]],
  );
  const classes = new Set(["existing-class"]);
  const systemListeners = new Set();
  const storageListeners = new Set();
  const root = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    dataset: {},
    style: {},
  };
  const localStorage = {
    getItem(key) {
      if (blocked) throw new Error("Storage denied");
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (blocked) throw new Error("Storage denied");
      values.set(key, value);
    },
  };
  const media = {
    matches: dark,
    addEventListener(_name, listener) {
      systemListeners.add(listener);
    },
    removeEventListener(_name, listener) {
      systemListeners.delete(listener);
    },
  };
  const browser = {
    document: { documentElement: root },
    localStorage,
    matchMedia: () => media,
    addEventListener(_name, listener) {
      storageListeners.add(listener);
    },
    removeEventListener(_name, listener) {
      storageListeners.delete(listener);
    },
  };
  return {
    browser,
    root,
    classes,
    values,
    systemListeners,
    storageListeners,
    systemChange(next) {
      media.matches = next;
      systemListeners.forEach((listener) => listener());
    },
    storageChange(value, key = THEME_STORAGE_KEY, storageArea = localStorage) {
      if (key === null) values.clear();
      else if (value === null) values.delete(key);
      else values.set(key, value);
      storageListeners.forEach((listener) =>
        listener({ key, newValue: value, storageArea }),
      );
    },
  };
}

for (const { preference, dark, expected } of [
  { preference: null, dark: false, expected: "light" },
  { preference: null, dark: true, expected: "dark" },
  { preference: "light", dark: true, expected: "light" },
  { preference: "dark", dark: false, expected: "dark" },
  { preference: "invalid", dark: true, expected: "dark" },
]) {
  test(`first paint and mounted theme agree: preference=${preference}, systemDark=${dark}`, () => {
    const fixture = browserFixture({ preference, dark });
    vm.runInNewContext(themeBootstrapScript, fixture.browser);
    assert.equal(fixture.root.dataset.theme, expected);
    assert.equal(fixture.root.style.colorScheme, expected);
    assert.equal(fixture.classes.has("dark"), expected === "dark");
    assert.equal(fixture.classes.has("existing-class"), true);
    const store = createThemeStore(fixture.browser);
    assert.equal(store.getSnapshot(), expected);
  });
}

test("toggle updates the whole document and persists across a fresh visit", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  store.setTheme("dark");
  assert.equal(fixture.root.dataset.theme, "dark");
  assert.equal(fixture.root.style.colorScheme, "dark");
  assert.equal(fixture.values.get(THEME_STORAGE_KEY), "dark");
  assert.equal(createThemeStore(fixture.browser).getSnapshot(), "dark");
  store.setTheme("light");
  assert.equal(fixture.classes.has("dark"), false);
  assert.equal(fixture.root.style.colorScheme, "light");
  assert.equal(fixture.values.get(THEME_STORAGE_KEY), "light");
  assert.equal(notifications, 2);
  unsubscribe();
});

test("system changes apply until the person makes an explicit choice", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  const unsubscribe = store.subscribe(() => {});
  fixture.systemChange(true);
  assert.equal(store.getSnapshot(), "dark");
  fixture.systemChange(false);
  assert.equal(store.getSnapshot(), "light");
  store.setTheme("dark");
  fixture.systemChange(false);
  assert.equal(store.getSnapshot(), "dark");
  unsubscribe();
});

test("another tab synchronizes theme, and removing the preference restores system theme", () => {
  const fixture = browserFixture({ preference: "light", dark: true });
  const store = createThemeStore(fixture.browser);
  const unsubscribe = store.subscribe(() => {});
  fixture.storageChange("dark");
  assert.equal(store.getSnapshot(), "dark");
  fixture.storageChange("light");
  assert.equal(store.getSnapshot(), "light");
  fixture.storageChange(null);
  assert.equal(store.getSnapshot(), "dark");
  fixture.storageChange("light");
  fixture.storageChange(null, null);
  assert.equal(store.getSnapshot(), "dark");
  unsubscribe();
});

test("unrelated storage and sessionStorage do not change the theme", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  const unsubscribe = store.subscribe(() => {});
  fixture.storageChange("dark", "other-preference");
  fixture.storageChange("dark", THEME_STORAGE_KEY, {});
  assert.equal(store.getSnapshot(), "light");
  unsubscribe();
});

test("denied storage still supports first paint, system theme and manual toggles", () => {
  const fixture = browserFixture({ blocked: true, dark: true });
  vm.runInNewContext(themeBootstrapScript, fixture.browser);
  assert.equal(fixture.root.dataset.theme, "dark");
  const store = createThemeStore(fixture.browser);
  const unsubscribe = store.subscribe(() => {});
  assert.doesNotThrow(() => store.setTheme("light"));
  fixture.systemChange(true);
  assert.equal(store.getSnapshot(), "light");
  assert.equal(fixture.root.dataset.theme, "light");
  unsubscribe();
});

test("subscriptions share browser listeners and remove them after the last subscriber", () => {
  const fixture = browserFixture();
  const store = createThemeStore(fixture.browser);
  const first = store.subscribe(() => {});
  const second = store.subscribe(() => {});
  assert.equal(fixture.systemListeners.size, 1);
  assert.equal(fixture.storageListeners.size, 1);
  first();
  assert.equal(fixture.systemListeners.size, 1);
  second();
  assert.equal(fixture.systemListeners.size, 0);
  assert.equal(fixture.storageListeners.size, 0);
  const remounted = store.subscribe(() => {});
  fixture.systemChange(true);
  assert.equal(store.getSnapshot(), "dark");
  remounted();
});

test("server rendering needs no browser and exposes a named keyboard-operable switch", () => {
  const html = renderToString(
    React.createElement(ThemeProvider, null, React.createElement(ThemeToggle)),
  );
  assert.match(html, /<button[^>]+type="button"[^>]+role="switch"/);
  assert.match(html, /aria-label="Tema gelap"/);
  assert.match(html, /aria-checked="false"/);
  const english = renderToString(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ThemeToggle, { lang: "en" }),
    ),
  );
  assert.match(english, /aria-label="Dark theme"/);
});
