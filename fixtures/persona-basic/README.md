# persona-basic

A lightweight theme (persona) with a solid header, a footer, an icon and an accent color. No
transparency, no light-on-light text: it is the case that must work everywhere.

## Files

- `persona.json` — the theme data. Image paths are relative to this directory; the loader turns
  them into absolute `file://` or `resource://` URLs before handing the object to
  `LightweightThemeManager`.
- `header.png` (1200×80), `footer.png` (1200×40), `icon.png` (64×64), `preview.png` (300×90).

## What it should prove

1. `LightweightThemeManager.currentTheme = data` applies header, footer and colors **live**.
2. `previewTheme(data)` shows it without committing.
3. Setting `currentTheme = null` (or the previous theme) reverts it.

## How to try it

There is nothing to install: read `persona.json`, resolve the four image paths, and apply the
object. Until M2 adds an *Apply persona* action to the panel, do it from a scratch driver or the
browser console:

```js
const { LightweightThemeManager } = Components.utils.import(
  "resource://gre/modules/LightweightThemeManager.jsm", {});
LightweightThemeManager.currentTheme = data; // data = persona.json with absolute image URLs
```

Expected: the toolbars get a `#2d3e50` header (text `#e8e8e8`), the status bar gets the footer, and
the accent color is used for highlights. No restart.
