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
