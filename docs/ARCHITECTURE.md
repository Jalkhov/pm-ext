# Architecture — pm-ext

This document describes the proposed technical design for `pm-ext`: a live-reload development
system for **Pale Moon** (platform **UXP**) add-ons.

> Status: **design draft**. None of this is implemented yet.

---

## 1. Overview

`pm-ext` consists of two pieces:

1. **Toolbox** — a privileged *bootstrap* add-on that lives inside the browser. It is the core of the
   product: it performs reloads and exposes a control panel.
2. **CLI (optional)** — an external Node process that watches files efficiently, packages, and
   validates. It talks to the toolbox when present.

```
                 ┌──────────────────────────────┐
                 │  Toolbox (bootstrap add-on)   │
                 │                               │
   events  ───▶ │  ┌─────────────────────────┐  │
                 │  │ Stable core              │  │
                 │  │  bootstrap.js            │  │
                 │  └─────────────────────────┘  │
                 │  ┌─────────────────────────┐  │
                 │  │ Reloadable modules       │  │
                 │  │  watcher.js              │  │
                 │  │  reloader.js             │  │
                 │  │  projects.js             │  │
                 │  │  logbus.js               │  │
                 │  └─────────────────────────┘  │
                 │  XUL control panel            │
                 └──────────────────────────────┘
                        ▲
                        │ (optional) loopback + token
                 ┌──────┴───────┐
                 │  CLI (Node)  │
                 │  watcher     │
                 │  build/lint  │
                 └──────────────┘
```

**Key decision:** the toolbox is the product; the CLI is an optional enhancement. This way the tool
works on its own (with internal *polling*) and scales with an external watcher when needed.

---

## 2. Why the toolbox lives inside the browser

A privileged *bootstrap* add-on has full *chrome* context. This allows, without IPC:

- Reloading bootstrapped extensions via `AddonManager`.
- Reloading chrome/overlays/CSS via `nsIXULChromeRegistry`.
- Applying personas and themes live.
- Reopening windows (`nsIWindowMediator`) to re-apply overlays.
- Integrating with DevTools / Browser Toolbox to debug the add-on under development.
- Capturing `bootstrap.js` errors and showing them in a panel.
- Managing development-profile prefs.

---

## 3. Stable core ↔ reloadable modules split

**Problem:** the toolbox **cannot** *disable/enable* its own id to reload itself, because that would
destroy its state, listeners, and overlays.

**Solution:**

- `bootstrap.js` only contains startup/shutdown and module loading.
- Logic lives in `core/*` and is loaded with *cache-busting*, so it can be reloaded without
  restarting the browser.

```js
// bootstrap.js (sketch)
function startup(params, reason) {
  const base = getResourceURI(params); // resource://<id>/core/
  loadCore(base + "reloader.js?t=" + Date.now());
  loadCore(base + "watcher.js?t=" + Date.now());
  // ...
}

function shutdown(params, reason) {
  unloadCore(); // clear timers, listeners, etc.
}
```

> Alternative: load via `file://` + query to force re-reading from the development directory.

---

## 4. Reload mechanisms per add-on type

### 4.1 Bootstrapped extension

Disable + enable is equivalent to `shutdown` + `startup`:

```js
addon.userDisabled = true;   // shutdown(ADDON_DISABLE) + unloadBootstrapScope()
addon.userDisabled = false;  // startup(ADDON_ENABLE) + addBootstrappedManifestLocation()
```

- `enable/disableRequiresRestart()` return `!aAddon.bootstrap` → `false` for bootstrapped.
- `bootstrap.js` is re-evaluated from disk.
- The `chrome.manifest` is re-registered on every `startup`.

### 4.2 Chrome / overlays / CSS

```js
const chromeReg = Cc["@mozilla.org/chrome/chrome-registry;1"]
  .getService(Ci.nsIXULChromeRegistry);

chromeReg.checkForNewChrome(); // registers new packages
chromeReg.reloadChrome();      // reloads chrome (including XUL)
chromeReg.refreshSkins();      // reloads styles only
```

Useful observers: `chrome-flush-caches`, `chrome-flush-skin-caches`, `startupcache-invalidate`.

### 4.3 Personas / lightweight themes

```js
LightweightThemeManager.currentTheme = data; // applies live
LightweightThemeManager.previewTheme(data);  // temporary preview
```

### 4.4 Complete themes

- Requires `extensions.dss.enabled = true` (DSS = *Dynamic Skin Switching*).
- Afterwards: `nsIXULChromeRegistry.refreshSkins()`.
- Prefs: `extensions.dss.switchPending`; skin switching via `XPIProvider.applyThemeChange()`.

### 4.5 Summary table

| Type | Strategy | Live |
|---|---|---|
| Bootstrap | toggle `userDisabled` | ✅ |
| Chrome manifest | `checkForNewChrome` / re-registration on startup | ✅ (new windows) |
| Merged overlays | reopen windows / `loadOverlay` | ⚠️ |
| Persona | `LightweightThemeManager` | ✅ |
| Complete theme | DSS + `refreshSkins` | ⚠️ (with DSS) |
| Classic overlay | restart (or *reload chrome*) | ❌ |
| Locale / dictionary / NPAPI | restart | ❌ |

---

## 5. Watcher

### 5.1 In-browser (default)

UXP has no native watcher, so **polling** is used:

- `nsITimer` with a configurable interval (e.g. 400–800 ms).
- Walk the project directory (`nsIFile` / `OS.File.DirectoryIterator`).
- Compare `lastModifiedTime` (and optionally size).
- Configurable *ignore globs*.
- Event *debounce* so multi-file saves don't trigger mid-write reloads.

### 5.2 External watcher (optional)

- Node + `chokidar` (or equivalent).
- Sends change events to the toolbox over loopback + token.
- More efficient for large projects with many files.

---

## 6. CLI ↔ Toolbox channel (optional)

A minimal, secure proposal:

- The toolbox opens `@mozilla.org/network/server-socket;1` on **`127.0.0.1` only**.
- Handshake with a per-session **token**.
- Newline-delimited JSON protocol:

```json
{"cmd":"reload","id":"my-addon@example.com"}
{"cmd":"chrome","action":"reloadChrome"}
{"cmd":"theme","data":{...}}
```

- Response: `{"ok":true,"ms":123}` or `{"ok":false,"error":"..."}`.
- Socket-free alternative: an events file polled by the toolbox.

---

## 7. Project management

- `pm-ext.json` (or `.pmdevrc`) at the add-on root describes it:

```json
{
  "id": "my-addon@example.com",
  "type": "bootstrap",
  "entry": "bootstrap.js",
  "ignore": ["**/*.xpi", "node_modules/**", ".git/**"],
  "reload": {
    "on": ["bootstrap.js", "**/*.js", "chrome.manifest", "**/*.xul", "**/*.css"]
  }
}
```

- Registration via **proxy file**: a file `<id>` in `…/extensions/` containing the path to the
  working folder.
- The toolbox can create/remove those *proxy files* from the panel.

---

## 8. Control panel (XUL)

- Project list with status (active / error / disabled).
- Actions: *Reload*, *Reload Chrome*, *Apply Theme*, *Reopen Windows*, *Open DevTools*.
- Log console with `bootstrap.js` errors and `AddonManager` events.

---

## 9. Development profile prefs

The toolbox should manage (in its dedicated profile):

- `extensions.dss.enabled = true` (for complete themes).
- Disable add-on auto-update during development.
- Avoid touching the user's main profile.

---

## 10. Limitations that shape the design

- **Module cache:** `Cu.import` is not cleared on reload; requires `Cu.unload` or `loadSubScript`
  with a unique query.
- **Merged overlays:** not re-applied to existing windows.
- **Toolbox self-reload:** solved by the core/modules split.
- **Internal APIs:** `XPIProvider` is not a public API; isolate it.
- **Overlay extensions:** limited reload; do not promise full hot-reload.
