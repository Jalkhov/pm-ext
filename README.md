# pm-ext

> A **live-reload development tool** for **Pale Moon** (UXP platform) add-ons: extensions, themes, and personas.

**Status:** 📝 Idea / initial research — no code yet.
**Goal:** a functional equivalent to [`web-ext`](https://github.com/mozilla/web-ext) for the XUL/XPCOM ecosystem of Pale Moon.
**License:** MPL-2.0.

---

## Table of contents

- [Motivation](#motivation)
- [What is pm-ext](#what-is-pm-ext)
- [Context: why web-ext does not map 1:1](#context-why-web-ext-does-not-map-11)
- [The Pale Moon add-on ecosystem](#the-pale-moon-add-on-ecosystem)
- [Feasibility: what can be hot-reloaded](#feasibility-what-can-be-hot-reloaded)
- [Key research findings](#key-research-findings)
- [Proposed architecture](#proposed-architecture)
- [Components](#components)
- [Usage flow](#usage-flow)
- [Technical design](#technical-design)
- [Known limitations](#known-limitations)
- [Risks and mitigations](#risks-and-mitigations)
- [Roadmap (near term)](#roadmap-near-term)
- [Repository structure](#repository-structure)
- [Prior art and related tools](#prior-art-and-related-tools)
- [How to contribute](#how-to-contribute)
- [License](#license)
- [References](#references)

---

## Motivation

Pale Moon is an independent browser built on **UXP** (Unified XUL Platform, a fork of Firefox 52 ESR) that **keeps the classic XUL/XPCOM add-on model** and **does not support WebExtensions by design**.

In the Firefox world, `web-ext run` lets you:

1. Install an extension in the browser (temporary mode).
2. Watch the source files.
3. **Automatically reload the extension** when you save changes.

In Pale Moon, **nothing equivalent exists**. Developing extensions, themes, or personas is still a manual loop of *package → install → restart → test*. `pm-ext` aims to close that gap.

---

## What is pm-ext

`pm-ext` aims to be a toolkit for developing Pale Moon add-ons with **hot-reload**:

- **In-browser toolbox** (a privileged bootstrap add-on) that reloads your add-ons, applies themes/personas, and exposes a control panel.
- **Optional CLI** (efficient external watcher + build/lint) that connects to the toolbox.

Design philosophy:

- **In-browser first**: most of the value lives in an add-on with direct access to `AddonManager`, the chrome registry, `LightweightThemeManager`, and DevTools.
- **No fragile dependencies**: it works without a socket if you don't want one; the external watcher is an enhancement, not a requirement.
- **Isolated**: meant for a **separate development profile**, never your daily profile.

---

## Context: why `web-ext` does not map 1:1

`web-ext` relies on two things that **do not exist in UXP/Pale Moon**:

| `web-ext` mechanism | Available in Pale Moon? |
|---|---|
| WebExtensions (`manifest.json`) | ❌ Not supported by design |
| DevTools remote protocol for temporary installs | ⚠️ RDP exists, but… |
| `AddonManager.installTemporaryAddon()` | ❌ **Removed in UXP** |
| `AddonWrapper.reload()` | ❌ **Removed in UXP** |

> **Evidence:** in UXP (`release` branch) there is no occurrence of `installTemporaryAddon`, nor a `reload()` method on `AddonWrapper`. The inherited DevTools code (`devtools/server/actors/addon.js`) calls `this._addon.reload()`, and `about:debugging` calls `AddonManager.installTemporaryAddon(...)`. Since those methods don't exist, the *"Load Temporary Add-on"* and *"Reload"* buttons in Pale Moon's `about:debugging` are **functionally broken or severely limited**.

**Conclusion:** `web-ext` cannot be ported; the **browser side must be rewritten** on top of the XUL/XPCOM mechanisms that do exist.

---

## The Pale Moon add-on ecosystem

| Type | Description | Hot-reload? |
|---|---|---|
| **Overlay** (toolkit) | Classic extension with `chrome.manifest` + `overlay` | ❌ Restart required (partial with *reload chrome*) |
| **Bootstrap** (restartless) | `bootstrap.js` with `install/startup/shutdown/uninstall` | ✅ Yes, disable/enable |
| **Jetpack** (Add-on SDK) | Uses bootstrap internally | ✅ Yes (deprecated) |
| **Complete theme** | XPI with a *skin* | ⚠️ Only with `extensions.dss.enabled=true` |
| **Persona / lightweight theme** | Pseudo add-on based on prefs/service | ✅ Yes |
| **Locale / Dictionary** | Localization / spellcheck | ❌ Restart |
| **Search plugin** | Search engine | ❌ Restart |
| **NPAPI plugin** | Native plugin (Flash, Java…) | ❌ Restart |

### Installing "from source": the *proxy file*

UXP supports the classic **pointer file**: a text file named `<addon-id>` inside `…/extensions/` whose contents are the **path to your source folder**. That way the add-on loads directly from your working directory without packaging or signing an XPI.

```
<profile>/extensions/my-addon@example.com      ← text file
└── contents: /home/user/projects/my-addon     ← actual development folder
```

---

## Feasibility: what can be hot-reloaded

| Target | Hot-reload? | Primary mechanism |
|---|---|---|
| **Bootstrapped** extension (`bootstrap.js`) | ✅ Yes | `addon.userDisabled = true/false` |
| Internal modules via `Cu.import` | ⚠️ Partial | Require explicit `Cu.unload` |
| `chrome.manifest` / bootstrapped overlays | ✅ Re-registration + new windows | `addBootstrappedManifestLocation` |
| Classic **overlay** extension | ❌ No / ⚠️ partial | `checkForNewChrome()` + reopen windows |
| **Complete theme** | ⚠️ Only with DSS | `extensions.dss.enabled=true` + `refreshSkins()` |
| **Persona / lightweight theme** | ✅ Yes | `LightweightThemeManager.currentTheme` |
| Chrome CSS / XUL | ⚠️ Partial | `reloadChrome()`, `refreshSkins()` |
| Locales / dictionaries / NPAPI | ❌ No | Restart |

---

## Key research findings

1. **Reloading a bootstrapped extension = disable + enable.**
   `enable/disableRequiresRestart()` return `!aAddon.bootstrap`, so bootstrapped add-ons need no restart. `bootstrap.js` is re-evaluated from disk and the `chrome.manifest` is re-registered.

2. **There is no native file watcher in UXP.** No `inotify`/`FileWatcher` is exposed to JS. Inside the browser, only **polling** is available (`nsITimer` + `nsIFile`/`OS.File`). An external watcher (chokidar) is more efficient for large projects.

3. **Pale Moon ships `extensions.dss.enabled = false`** (`palemoon/app/profile/palemoon.js:219`). Enabling it lets complete-theme switching happen without a restart.

4. **Existing tooling is broken for reloading**: `about:debugging` depends on APIs removed from UXP.

5. **The *proxy file* is still supported**, allowing add-ons to load straight from the working directory.

6. **The `Cu.import` module cache is not cleared** when reloading a bootstrapped add-on (`unloadBootstrapScope` does not call `Cu.unload`). It must be handled explicitly.

See the technical detail and evidence in [`docs/RESEARCH.md`](docs/RESEARCH.md).

---

## Proposed architecture

```
┌────────────────────────────┐     (optional) change events   ┌──────────────────────────────┐
│  CLI (Node)                │  ────────────────────────────▶ │  Toolbox (bootstrap add-on)   │
│  - external watcher        │                                │  ┌──────────────────────────┐ │
│  - build / lint            │                                │  │ Stable core              │ │
│  - launches dev profile    │                                │  │  bootstrap.js            │ │
└────────────────────────────┘                                │  └──────────────────────────┘ │
                                                              │  ┌──────────────────────────┐ │
                                                              │  │ Reloadable modules       │ │
                                                              │  │  watcher / reloader /    │ │
                                                              │  │  projects / logbus       │ │
                                                              │  └──────────────────────────┘ │
                                                              │  XUL control panel            │
                                                              │  AddonManager / LWT / Chrome  │
                                                              └──────────────────────────────┘
```

**Recommended approach:** the **in-browser toolbox** is the core product. The **CLI is optional** and only adds efficient *file watching*, scripting, and packaging.

### Why in-browser

Advantages of a privileged toolbox add-on:

- Direct access to `AddonManager` / `XPIProvider` without IPC.
- `nsIXULChromeRegistry` (`reloadChrome`, `refreshSkins`, `checkForNewChrome`) for chrome/overlays/CSS.
- `LightweightThemeManager` for live personas.
- Window reopening (`nsIWindowMediator`) — the only place where overlays can realistically be re-applied.
- DevTools / Browser Toolbox integration to debug the add-on under development.
- Capturing `bootstrap.js` errors and showing them in a dedicated log panel.
- No socket or protocol: fewer security surfaces and failure modes.

---

## Components

### 1. Toolbox (bootstrap add-on)

- **Stable core** (`bootstrap.js`): minimal, never reloads itself.
- **Reloadable modules** (`core/*`): watcher, reloader, project management, log bus. Loaded with *cache-busting* so the tool itself can be reloaded without restarting.
- **XUL panel**: project list, status, and *Reload*, *Reload Chrome*, *Apply Theme*, *Console*, *Reopen Windows* buttons.
- **Menu/keybinding overlay** declared in `chrome.manifest` (registered on every `startup`).

> ⚠️ **Self-reload:** the toolbox **cannot** disable/enable its own id without losing state and overlays. Hence the stable-core ↔ reloadable-modules split.

### 2. Optional CLI (Node)

- `pm-ext run <dir>`: watches files and launches/coordinates Pale Moon with a development profile.
- `pm-ext build`: packages the XPI (`install.rdf` + zip).
- `pm-ext lint`: custom validation (there is no official XUL/bootstrap linter).
- Talks to the toolbox over a minimal local endpoint (loopback + token) or an events file.

### 3. Project configuration

A project file (e.g. `pm-ext.json`) at the add-on root describes what it is and how to reload it:

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

---

## Usage flow

### Toolbox mode (browser only)

1. Install the toolbox into a **development profile** (via *proxy file*).
2. Register your project in the panel (it creates the *proxy file* for you).
3. Edit and save: the toolbox detects the change (polling) and reloads.
4. Errors show up in the panel; you can open the add-on's DevTools.

### Hybrid mode (CLI + toolbox)

```bash
# Watch changes and forward them to the toolbox (efficient watcher)
pm-ext run ./my-addon --external-watch

# Package
pm-ext build ./my-addon

# Validate
pm-ext lint ./my-addon
```

---

## Technical design

### Reloading a bootstrapped extension

```js
const { AddonManager } = Components.utils.import(
  "resource://gre/modules/AddonManager.jsm", {}
);

AddonManager.getAddonByID(ADDON_ID, addon => {
  addon.userDisabled = true;   // shutdown(ADDON_DISABLE) + unloadBootstrapScope()
  addon.userDisabled = false;  // startup(ADDON_ENABLE) + addBootstrappedManifestLocation()
});
```

- `AddonWrapper.userDisabled` → `XPIProvider.updateAddonDisabledState`.
- For bootstrapped add-ons, `enable/disableRequiresRestart()` are `false`.
- `bootstrap.js` is re-evaluated from disk and the `chrome.manifest` is re-registered.

### Reloading chrome / overlays / CSS

```js
const chromeReg = Components.classes["@mozilla.org/chrome/chrome-registry;1"]
  .getService(Components.interfaces.nsIXULChromeRegistry);

chromeReg.checkForNewChrome(); // registers new packages
chromeReg.reloadChrome();      // reloads chrome (including XUL)
chromeReg.refreshSkins();      // reloads styles only (skins)
```

### Personas / lightweight themes

```js
const { LightweightThemeManager } = Components.utils.import(
  "resource://gre/modules/LightweightThemeManager.jsm", {}
);

LightweightThemeManager.currentTheme = themeData; // applies live
LightweightThemeManager.previewTheme(themeData);  // temporary preview
```

### Complete themes

- Requires `extensions.dss.enabled = true` (DSS: *Dynamic Skin Switching*).
- Afterwards: `nsIXULChromeRegistry.refreshSkins()`.
- Related prefs: `extensions.dss.switchPending`; skin selection via `XPIProvider.applyThemeChange()`.

### Polling watcher (no CLI)

`nsITimer` + `lastModifiedTime` comparison while walking the project directory. Configurable interval (e.g. 400–800 ms) with *ignore globs*.

More detail in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Known limitations

- **No native watcher:** polling inside the browser, or an external watcher.
- **Module cache:** `Cu.import` modules are not reloaded automatically; requires `Cu.unload` or `loadSubScript` with a unique query.
- **Already-merged overlays:** not re-applied to existing windows; they must be reopened or `loadOverlay` forced.
- **Tool self-reload:** solved with a stable core + reloadable modules; the toolbox never reloads itself.
- **Overlay extensions:** imperfect/fragile reload (restart required in the general case).
- **Locales, dictionaries, and NPAPI plugins:** always require a restart.
- **Internal APIs:** `XPIProvider` is not a public API and may change between Pale Moon versions; it must be isolated.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `Cu.import` module cache | Changes not visible | `Cu.unload` / `loadSubScript` with query |
| Overlays not re-applied | Visual changes missing | `checkForNewChrome` + window reopening |
| Unstable internal APIs | Breakage across versions | Isolate in one module; prefer `AddonManager`/observers |
| Themes without DSS | "Doesn't work" | Toolbox enables DSS in the dev profile |
| Open local socket (CLI mode) | Security | Loopback only + token + minimal protocol |
| Costly polling | CPU/battery | Configurable interval, ignores, external watcher |
| Damaging the daily profile | Data loss | Dedicated/temporary dev profile; never touch the main one |

---

## Roadmap (near term)

> This is a **living plan, not a fixed schedule**. Only the near term is detailed; everything beyond
> is intentionally vague and **will change** as we learn. The goal is to move in small, testable
> steps — build a bit, test it, polish it, then move on. When an assumption proves wrong, update this
> section (and [`docs/`](docs/)) instead of forcing the original plan.

**How we work**

- Build **vertical slices**: each milestone is usable and demoable end to end.
- **No big-bang.** One capability at a time.
- Test on a **real Pale Moon install** before moving on; polish before piling on features.
- Keep the CLI ↔ toolbox protocol **language-agnostic** so the CLI can be rewritten later.
- Prefer a **working tool** over a complete one.

**Guiding constraints**

- Toolbox JS targets the **Firefox 52-era** engine (no ES modules, no modern APIs).
- The toolbox **never reloads itself** — only its reloadable modules.
- Never touch the user's **daily profile**; always a dedicated dev profile.

### M0 — Setup & proof of concept

*Goal: prove the core assumption before writing any real tooling.*

- [ ] Create a throwaway bootstrapped add-on and load it via a **proxy file** in a dev profile.
- [ ] Verify that toggling `userDisabled` **re-runs `bootstrap.js` from disk** (log a timestamp).
- [ ] Confirm the `chrome.manifest` is **re-registered** on reload.
- [ ] Document the dev-profile setup (location, how to launch it).
- [ ] Decide toolbox authoring: **plain JS (default)** vs TypeScript — record the decision.

**Exit criteria:** editing `bootstrap.js` and toggling the add-on shows new code without a restart.

### M1 — Toolbox MVP (browser only, polling)

*Goal: a minimal, usable toolbox that reloads one bootstrapped project.*

- [ ] `bootstrap.js` stable core + `core/*` loader with **cache-busting**.
- [ ] Project config (`pm-ext.json`) parsing.
- [ ] Polling watcher (`nsITimer` + `nsIFile.lastModifiedTime`), **ignore globs**, **debounce**.
- [ ] Reloader for bootstrapped extensions (`userDisabled` toggle).
- [ ] Minimal **XUL panel**: project list, status, Reload button, log output.
- [ ] Proxy-file management from the panel (register / unregister a project).
- [ ] Clean shutdown (clear timers/listeners to avoid leaks).
- [ ] Manual test: edit `bootstrap.js` and a JS file, watch both reload.

**Exit criteria:** a developer can point the toolbox at a real add-on and iterate **without restarting**.

### M2 — Themes & personas

- [ ] Apply / preview personas via `LightweightThemeManager`.
- [ ] Complete themes: enable **DSS** in the dev profile + `refreshSkins()`.
- [ ] Panel actions: *Apply Theme*, *Apply Persona*.
- [ ] Test with a real complete theme and a real persona.

**Exit criteria:** editing a persona updates live; editing a complete theme updates with DSS enabled.

### M3 — Chrome & overlays

- [ ] `checkForNewChrome()` / `reloadChrome()` actions in the panel.
- [ ] Assisted **window reopening** to re-apply overlays (with a clear warning).
- [ ] Document exactly what does and does not reload.

### M4 — Optional CLI (Node + TypeScript)

- [ ] Confirm stack; write the **protocol spec** (loopback + token, newline-delimited JSON).
- [ ] `pm-ext run <dir>` with an external watcher (`chokidar`).
- [ ] `pm-ext build` (XPI packaging).
- [ ] `pm-ext lint` (`install.rdf` + structure validation).
- [ ] Distribution via `npx` / npm.

### Later / not committed yet

*Deliberately vague — revisit only after M1–M2.*

- Richer diagnostics (per-add-on console, error aggregation).
- Multi-project workflows.
- Cross-version compatibility matrix.
- Possible single-binary rewrite (Go) if distribution becomes the blocker.

**Current focus:** M0 → M1.

---

## Repository structure

> **Placeholder** structure — it will be filled in as the project progresses.

```
pm-ext/
├─ README.md              ← this document
├─ LICENSE                ← MPL-2.0
├─ .gitignore
├─ docs/
│  ├─ ARCHITECTURE.md     ← technical design and mechanisms
│  └─ RESEARCH.md         ← research and evidence
├─ extension/             ← (placeholder) bootstrap toolbox add-on
├─ cli/                   ← (placeholder) Node CLI
└─ examples/              ← (placeholder) sample projects
```

---

## Prior art and related tools

| Tool | Contribution | Status on Pale Moon 35 |
|---|---|---|
| **Extension Developer's Extension** (Ted Mielczarek) | JS Shell, Extension Builder, **Reload All Chrome**, live XUL editor | Very old (Firefox 4); likely needs porting |
| **Extension Auto-Installer** (Wladimir Palant) | `localhost:8888` server; uploads an XPI and installs it; basis of `jpm watchpost` | Discontinued; conceptual reference |
| **ThemeTool / Theme Builder / Theme Styler Plus** (riiis) | Switch/apply themes and personas **without restarting** | ✅ Active; proves live theme switching |
| **Pentadactyl (Pale Moon fork)** | *Proxy file* + `:rehash` to reload without restarting | ✅ Proof of extension reload |
| **`about:debugging`** | Temporary load + reload | ⚠️ Present but **broken** (missing APIs) |
| **Moon Tester Tool** (JustOff) | Install incompatible extensions | ✅ Useful as support |

No working `web-ext` equivalent has been found for XUL/Pale Moon.

---

## How to contribute

The project is in the **idea/research** phase. Contributions welcome:

- Fixes or extensions to the research (`docs/RESEARCH.md`).
- Feedback on the proposed architecture (`docs/ARCHITECTURE.md`).
- Use cases and priorities for the MVP.
- Proofs of concept of the *toolbox* across Pale Moon versions.

For now, open an issue or a discussion before submitting large changes.

---

## License

This project is distributed under the **Mozilla Public License 2.0 (MPL-2.0)**, the same license used by the Pale Moon/UXP ecosystem. See [`LICENSE`](LICENSE).

---

## References

- Pale Moon — Developer Site: <https://developer.palemoon.org/addons>
- Pale Moon — Roadmap: <https://www.palemoon.org/roadmap.shtml>
- UXP (source): <https://repo.palemoon.org/MoonchildProductions/UXP>
- `XPIProvider.jsm` (bootstrap lifecycle, `enableRequiresRestart`, `flushChromeCaches`)
- `toolkit/mozapps/extensions/AddonManager.jsm`, `XPIProviderUtils.js`
- `toolkit/mozapps/extensions/LightweightThemeManager.jsm`
- `chrome/nsIChromeRegistry.idl` (`nsIChromeRegistry` / `nsIXULChromeRegistry`)
- `palemoon/app/profile/palemoon.js` (`extensions.dss.*` prefs)
- `devtools/client/aboutdebugging/*`, `devtools/server/actors/addon{,s}.js`
- `web-ext`: <https://github.com/mozilla/web-ext>
- MDN — Bootstrapped extensions (historical archive)
- Extension Developer's Extension: <https://ted.mielczarek.org/code/mozilla/extensiondev/>
