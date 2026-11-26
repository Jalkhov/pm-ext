# theme-minimal

A complete theme whose browser skin is a single file. It exists to test the theme lifecycle
(install, enable, DSS apply, skin reload) without carrying a full theme's worth of assets.

## How it works

A complete theme is a **skin package**, not a set of overrides. `chrome.manifest` declares:

```
skin browser pm-ext-theme/1.0 skin/browser/
```

and `install.rdf` repeats the same name in `<em:internalName>pm-ext-theme/1.0</em:internalName>`.
The skin name and the internal name must match; without an internal name Pale Moon rejects the
add-on (`Themes must include an internalName property`).

The only file provided is `skin/browser/places/places.css`, which adds a border under the Library
toolbar. **Everything else the browser asks the `browser` skin for is missing**, so while this theme
is active the rest of the chrome is unstyled. That is the trade-off for a four-file fixture: use it
in a throwaway profile, never in the daily one.

Overrides and `content` packages are deliberately not used: in this build a theme's manifest only
registers `skin` packages. `override` lines are ignored and `chrome://<theme>/content/...` does not
resolve.

## Install

```sh
PROFILE=/tmp/pmext-theme
mkdir -p "$PROFILE/extensions"
printf '%s' "$PWD/fixtures/theme-minimal" > "$PROFILE/extensions/pm-ext-theme-minimal@example.com"
printf 'user_pref("extensions.dss.enabled", true);\n' > "$PROFILE/user.js"
palemoon -no-remote -profile "$PROFILE" about:blank
```

A theme starts disabled; enable **pm-ext theme minimal** in the Add-ons Manager. With DSS on it
applies without a restart.

## What it proves

Verified on Pale Moon 35.0.2 (UXP 6.9.0):

1. A theme installed through a proxy file is recognized (`type` = theme).
2. `extensions.dss.enabled = true` + enabling applies it live: `isActive = true`,
   `extensions.dss.switchPending = false`.
3. `chrome://browser/skin/places/places.css` resolves to this fixture's file.
4. The Library toolbar reports `border-bottom-color: rgb(74, 101, 114)`.

Step 4 is the end-to-end check: it reads the computed style of a real window, not just the registry.

## Gotchas

- `install.rdf` without `<em:internalName>` makes Pale Moon discard the proxy file.
- A skin package that omits files breaks their styling; there is no per-file fallback.
