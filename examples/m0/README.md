# M0 — Proof of concept

The throwaway harness that validates pm-ext's core assumption: **a bootstrapped
add-on re-runs `bootstrap.js` from disk when `userDisabled` is toggled, without
restarting the browser.**

No user interaction: the driver does the whole test and quits Pale Moon.

```
target/   throwaway bootstrap add-on (logs its lifecycle, has a chrome.manifest)
driver/   test harness: toggles the target, rewrites its code, checks, quits
run-m0.sh creates/reuses an isolated profile and runs the test
```

## Run

```bash
examples/m0/run-m0.sh          # uses .dev-profile/ inside the repo
PM_EXT_PROFILE=/tmp/pm-dev examples/m0/run-m0.sh
PALEMOON=/path/to/palemoon examples/m0/run-m0.sh
```

Requires a graphical session (UXP has no headless mode).

## What the driver does

1. Waits 4 s for the target to start, reads its lifecycle log.
2. Reads the target's **proxy file** to locate the source directory.
3. Sets `userDisabled = true` → target logs `shutdown ... ADDON_DISABLE`.
4. Rewrites `const BUILD` in the target's `bootstrap.js` to a timestamp nonce.
5. Sets `userDisabled = false` → target logs `startup build=<nonce> ADDON_ENABLE`.
6. Resolves `chrome://pm-m0-target/content/marker.txt` (chrome.manifest check).
7. Writes `m0-driver.log` and quits the browser.

## Result (Pale Moon 35.0.2, Linux x86_64, UXP 6.9.0)

```
target loaded: pm-ext M0 target 1.0 userDisabled=false isActive=true
target log @startup: startup build=v1 reason=APP_STARTUP
chrome @startup: file:///.../target/content/marker.txt
after disable: userDisabled=true isActive=false
target log @disable: shutdown build=v1 reason=ADDON_DISABLE
proxy file -> /home/jalkhov/Documentos/GitHub/pm-ext/examples/m0/target
rewrote bootstrap.js BUILD to v-1795662981244
after enable: userDisabled=false isActive=true
target log @enable: startup build=v-1795662981244 reason=ADDON_ENABLE
chrome @reload: file:///.../target/content/marker.txt
RESULT: PASS (new code ran without restarting)
```

Same process throughout. Editing code + restarting the add-on required no browser
restart, and the chrome package resolved after the reload.

## Runtime findings (matter for M1)

- On a **fresh profile** the add-ons start with `ADDON_INSTALL`, not `APP_STARTUP`;
  the driver triggers on both and waits for the target to become active.
- **`AddonManager.getAddonByID` is callback-only** in UXP. Calling it without a
  callback throws `aCallback must be a function`; it does not return a promise.
- **No `TextEncoder`/`TextDecoder`** in the bootstrap sandbox. Use
  `OS.File.read/writeAtomic(path, string, { encoding: "utf-8" })`.
- **`OS.File` works** in the sandbox (import `resource://gre/modules/osfile.jsm`).
- The chrome URL resolves after reload, but that only proves the package mapping
  exists — it does **not** prove browsers don't serve cached chrome content.

## Decision: toolbox language

**Plain JS (ES5-era).** The engine is Firefox 52-era: no ES modules, and
TypeScript would require a build step plus a down-level bundle for zero runtime
benefit. Reloadable `core/*` modules will be loaded with `loadSubScript` and a
cache-busting query.
