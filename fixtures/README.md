# Fixtures

Small, disposable add-ons that pm-ext uses to test itself. They are never installed in the daily
profile: every recipe here targets a throwaway `-profile` directory under `/tmp`.

| Fixture | Kind | Proves | Status |
|---|---|---|---|
| `persona-basic/` | Lightweight theme (JSON) | apply a persona live and read it back | verified on 35.0.2 |
| `theme-minimal/` | Complete theme (one-file skin) | install, enable with DSS, resolve and reload a skin | verified on 35.0.2 |
| `extension-chrome/` | Extension with chrome | `chrome.manifest` re-registration and cached `chrome://` content | planned, M3 |
| `theme-advanced/` | Complete theme (many packages) | what the minimal theme cannot reach | planned, M2/M3 |
| `kitchen-sink/` | Everything at once | manual smoke test only, no assertions | planned, end |

One fixture per capability: a failure points at one API, not at a pile of them. The persona is the
"must always work" baseline; the theme fixture is intentionally incomplete (a complete theme needs
every file the browser asks for) and belongs in a throwaway profile.

All fixtures declare `minVersion` `35.0.2` and were written for that release.

## Install a theme as a proxy add-on

```sh
PROFILE=/tmp/pmext-fixtures
mkdir -p "$PROFILE/extensions"
printf '%s' "$PWD/fixtures/theme-minimal" > "$PROFILE/extensions/pm-ext-theme-minimal@example.com"
palemoon -no-remote -profile "$PROFILE" about:blank
```

The persona is not an XPI: it is a JSON document that pm-ext applies through
`LightweightThemeManager` (see its README).
