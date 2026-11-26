# Research — pm-ext

Research notes and **technical evidence** gathered from the UXP/Pale Moon source and official
documentation. It backs the decisions in [`ARCHITECTURE.md`](ARCHITECTURE.md).

> Primary source: UXP (Unified XUL Platform), `release` branch (basis of Pale Moon 35, 2026).

---

## 1. Project context

- Pale Moon: independent browser built on **UXP**, a fork of **Firefox 52 ESR**.
- Platform: **Goanna** (rendering) + **UXP** (application/XUL).
- Add-on model: **XUL/XPCOM** (overlay, bootstrap, Jetpack); **no WebExtensions**.
- Official docs: <https://developer.palemoon.org/addons>.

---

## 2. Add-on types

| Type | Manifest / entry | Restartless? |
|---|---|---|
| Overlay | `install.rdf` + `chrome.manifest` + `overlay` | No |
| Bootstrap | `install.rdf` (`bootstrap=true`) + `bootstrap.js` | Yes |
| Jetpack (SDK) | `install.rdf` + `bootstrap.js` | Yes (deprecated) |
| Complete theme | `install.rdf` (type `theme`) + skin | No (unless DSS) |
| Persona | Prefs/service (`lightweightThemes.*`) | Yes |

---

## 3. Evidence: missing APIs (the `web-ext` blocker)

`web-ext` depends on temporarily installing and reloading extensions. In UXP:

- **`AddonManager.installTemporaryAddon`** → **0 occurrences** in:
  - `toolkit/mozapps/extensions/AddonManager.jsm`
  - `toolkit/mozapps/extensions/internal/XPIProvider.jsm`
- **`AddonWrapper.reload()`** → **does not exist**; the wrapper ends without that method.
- The DevTools code that would use it:
  - `devtools/server/actors/addon.js` → `this._addon.reload()` (call to a nonexistent method).
  - `devtools/client/aboutdebugging/components/addons/controls.js` →
    `AddonManager.installTemporaryAddon(file)` (nonexistent method).

**Conclusion:** Pale Moon's `about:debugging` renders the *"Load Temporary Add-on"* and *"Reload"*
buttons, but **both rely on APIs UXP removed**. They are not a reliable path.

Verified against alternate mirrors too (`roytam1/UXP`, `dbsoft/UXP`): same result.

---

## 4. Evidence: bootstrapped lifecycle

In `XPIProvider.jsm`:

- `loadBootstrapScope()` — creates a `Cu.Sandbox` and runs `loadSubScript("bootstrap.js")`,
  **reading from disk**.
- `unloadBootstrapScope()` — drops the sandbox (`delete this.bootstrapScopes[aId]`), **without**
  `Cu.unload` of imported modules.
- `callBootstrapMethod()` — invokes `install/startup/shutdown/uninstall` in the sandbox; on
  `startup` it calls `Components.manager.addBootstrappedManifestLocation(file)`, and on `shutdown`
  (if not `APP_SHUTDOWN`) it removes it.
- `BOOTSTRAP_REASONS`:
  `APP_STARTUP=1, APP_SHUTDOWN=2, ADDON_ENABLE=3, ADDON_DISABLE=4, ADDON_INSTALL=5, ADDON_UNINSTALL=6, ADDON_UPGRADE=7, ADDON_DOWNGRADE=8`.

### Restart or not

- `enableRequiresRestart(aAddon)` → `return !aAddon.bootstrap;` (themes have special DSS logic).
- `disableRequiresRestart(aAddon)` → same.
- `updateAddonDisabledState()` → if `!needsRestart`, it calls `updateAddonActive` and
  `callBootstrapMethod("shutdown"/"startup")`.

**Conclusion:** for bootstrapped extensions, hot-reload is `userDisabled = true` followed by
`userDisabled = false`.

---

## 5. Evidence: themes and personas

- `palemoon/app/profile/palemoon.js:219` → `pref("extensions.dss.enabled", false);`
  (DSS = Dynamic Skin Switching; **disabled by default**).
- `enableRequiresRestart()` for themes: if DSS is enabled → no restart required.
- `XPIProvider.applyThemeChange()` — applies the pending skin change
  (`extensions.dss.switchPending`, `XPIProvider.selectedSkin`).
- `LightweightThemeManager.jsm` (`toolkit/mozapps/extensions/LightweightThemeManager.jsm`):
  - `get/set currentTheme`
  - `previewTheme(data)` / `resetPreview()`
  - `themeChanged()`, `updateCurrentTheme()`
  - observer `lightweight-theme-changed`

**Conclusion:** personas are live by nature; complete themes are live only with DSS.

---

## 6. Evidence: chrome registry

`chrome/nsIChromeRegistry.idl` defines:

```idl
interface nsIChromeRegistry {
  nsIURI convertChromeURL(in nsIURI aChromeURL);
  void checkForNewChrome();
  boolean wrappersEnabled(in nsIURI aURI);
};

interface nsIXULChromeRegistry : nsIChromeRegistry {
  void reloadChrome();
  ACString getSelectedLocale(in ACString packageName, [optional] in boolean asBCP47);
  boolean isLocaleRTL(in ACString package);
  void refreshSkins();
  boolean allowScriptsForPackage(in nsIURI url);
  boolean allowContentToAccess(in nsIURI url);
  boolean canLoadURLRemotely(in nsIURI url);
  boolean mustLoadURLRemotely(in nsIURI url);
};
```

`XPIProvider.jsm`:
- `flushChromeCaches()` notifies `startupcache-invalidate` and `message-manager-flush-caches`.
- Add-on changes notify `chrome-flush-caches` and `chrome-flush-skin-caches`.

**Conclusion:** there are supported mechanisms to refresh chrome/styles at runtime (with the
limitation of already-merged overlays).

---

## 7. Evidence: installing from source (*proxy file*)

`DirectoryInstallLocation._readDirectoryFromFile()` (in `XPIProvider.jsm`) reads a text file whose
contents are the **path to a directory** and loads it as an add-on.

> Verbatim code comment: *"Returns true if the given addon was installed in this location by a text
> file pointing to its real path."*

**Conclusion:** you can develop against a working directory without packaging an XPI.

---

## 8. Evidence: no native watcher

Search of the UXP tree: no `inotify`, `FileWatcher`, or `nsINativeFileWatcher` exposed to JS.

**Conclusion:** the watcher must be **polling** (in-browser) or **external** (Node).

---

## 9. Relevant prior art

- **Extension Developer's Extension (EDE)** — <https://ted.mielczarek.org/code/mozilla/extensiondev/>
  - Includes *"Reload All Chrome — Reload all chrome without caching. Useful for testing overlay
    changes without restarting."*
  - Also JS Shell/Environment, Extension Builder, live XUL editor.
  - Very old (Firefox 4 era); likely needs porting.
- **Extension Auto-Installer** (Wladimir Palant) — a `localhost:8888` server that installs XPIs;
  basis of `jpm watchpost`. Discontinued.
- **ThemeTool / Theme Builder / Theme Styler Plus** (riiis, addons.palemoon.org) — switch/apply
  themes and personas **without restarting**. Practical proof of live DSS and LWT.
- **Pentadactyl (Pale Moon fork)** — *proxy file* + `:rehash` command to reload the extension
  without restarting.
- **Moon Tester Tool** (JustOff) — install incompatible extensions.
- **`about:debugging`** — present but relies on missing APIs (see §3).

No `web-ext`-equivalent tool for XUL/Pale Moon was found.

---

## 10. Sources

- UXP: <https://repo.palemoon.org/MoonchildProductions/UXP>
  - `toolkit/mozapps/extensions/AddonManager.jsm`
  - `toolkit/mozapps/extensions/internal/XPIProvider.jsm`
  - `toolkit/mozapps/extensions/internal/XPIProviderUtils.js`
  - `toolkit/mozapps/extensions/LightweightThemeManager.jsm`
  - `chrome/nsIChromeRegistry.idl`, `chrome/nsChromeRegistry*.cpp`
  - `devtools/client/aboutdebugging/*`
  - `devtools/server/actors/addon.js`, `devtools/server/actors/addons.js`
- Pale Moon: `palemoon/app/profile/palemoon.js` (prefs).
- Docs: <https://developer.palemoon.org/addons>, <https://www.palemoon.org/roadmap.shtml>.
- `web-ext`: <https://github.com/mozilla/web-ext>.

---

## 11. Runtime findings (M0 proof of concept)

Measured on Pale Moon 35.0.2 / UXP 6.9.0 with the harness in [`examples/m0/`](../examples/m0/README.md):

- **Hot reload confirmed:** `userDisabled = true` → `shutdown(ADDON_DISABLE)`, then
  `userDisabled = false` → `startup(ADDON_ENABLE)` re-runs `bootstrap.js` **from disk**
  (a rewritten constant ran without restarting the browser).
- **Proxy file confirmed:** a text file in `<profile>/extensions/<id>` containing the
  absolute source path loads the add-on directly from the working directory.
- **`chrome.manifest` re-registered:** `chrome://<package>/...` resolves after the reload.
- **`AddonManager.getAddonByID` is callback-only.** It does **not** return a promise;
  calling it without a callback throws `aCallback must be a function`. Use
  `AddonManager.getAddonByID(id, callback)`.
- **No `TextEncoder` / `TextDecoder` in the bootstrap sandbox.** `OS.File` is available;
  read/write strings with `OS.File.read/writeAtomic(path, data, { encoding: "utf-8" })`.

---

## 12. Runtime findings (M1 watcher)

Also measured on Pale Moon 35.0.2 / UXP 6.9.0:

- **Polling works in a reloadable module.** A `TYPE_REPEATING_SLACK` timer and a recursive
  `nsIFile.directoryEntries` walk run correctly from a `loadSubScript` scope; the scan of a small
  project costs well under the 800 ms tick.
- **`directoryEntries` entries need a path-backed `nsIFile`.** The walk only works on an
  `nsIFile`; a plain path string has no `directoryEntries`.
- **Re-enabling needs a delay.** `userDisabled = true` makes `addon.isActive` false immediately,
  before the old scope is unloaded. Enabling right away re-ran the bootstrap, but waiting ~1 s
  avoids depending on that race: disable → wait ≥ 1 s → poll for inactive → enable.
- **Fresh-profile order:** add-ons start with reason `ADDON_INSTALL` (5) and the toolbox discovers
  project proxy files before any edit, so the watcher's first scan is a clean baseline.

---

## 13. Runtime findings (M2 fixtures)

Measured on Pale Moon 35.0.2 / UXP 6.9.0 with [`fixtures/`](../fixtures/README.md):

- **Themes need `<em:internalName>`.** Without it the add-on is rejected with
  `Themes must include an internalName property` and the proxy file is removed. The value must
  match the skin name in `chrome.manifest` (`skin browser pm-ext-theme/1.0 ...`).
- **A theme manifest only registers `skin` packages.** `content` packages do not resolve
  (`chrome://<theme>/content/...` → `NS_ERROR_FILE_NOT_FOUND`) and `override` lines are ignored.
  Restyling a single file therefore means declaring a `skin browser` package; missing files do not
  fall back per file, so a tiny theme leaves the rest of the chrome unstyled.
- **DSS applies a theme live.** With `extensions.dss.enabled = true`, setting
  `addon.userDisabled = false` leaves `isActive = true` and `extensions.dss.switchPending = false`;
  `refreshSkins()` then serves the new skin (`chrome://browser/skin/...` resolves to the fixture).
- **Local personas use `setLocalTheme(data)`.** Assigning
  `LightweightThemeManager.currentTheme = data` throws `NS_ERROR_ILLEGAL_VALUE`
  (0x80070057) for a local theme, and assigning `null` afterwards left the main loop unable to run
  timers in our probe. `setLocalTheme(data)` applied a persona with `file://` images and
  `currentTheme.id` read back correctly.

## 14. Runtime findings (M1 project config)

- **One watcher module instance per project.** `loadSubScript` of `core/watcher.js` keeps its state
  in the module scope, so a second `start()` would replace the first project's timer and directory.
  `core/main.js` loads the file once per project instead, and `start()` returns `{stop}` so
  refresh and shutdown can cancel each timer.
- **A 2500 ms one-shot timer created in a bootstrap sandbox stopped firing** about 20 s into the
  integration run, while 200 ms polling timers kept working. Two short waits replaced it. The
  toolbox itself only uses timers up to 1 s; if a longer delay is ever needed, build it from short
  ones.
- **Leftover browser processes share the profile.** Killing the test runner without its child left
  two Pale Moon instances watching the same folder, which showed up as duplicate reloads. The
  runner now backgrounds the browser, owns its pid and kills it on exit.
