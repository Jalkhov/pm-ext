# Toolbox (M1, in progress)

The privileged add-on that pm-ext is built around.

**Working today**

- Stable `bootstrap.js` (never reloaded) plus a reloadable `core/main.js`, evaluated with a
  cache-busting query in a fresh scope.
- XUL panel (`chrome://pm-ext/content/panel.xul`) that opens ~1.5 s after start and shows the
  Pale Moon version, the UXP engine, the current core build and a log.
- Startup gate: the Pale Moon release is compared with `MIN_APP_VERSION` (kept in sync with
  `install.rdf`); below it the panel warns and disables reload.
- Log at `<profile>/pmext.log`.

**Not there yet:** file watching, project registration, proxy-file management, toolbar entry.

## Run it

```sh
PROFILE=/tmp/pmext-dev
mkdir -p "$PROFILE/extensions"
printf '%s' "$PWD/extension" > "$PROFILE/extensions/pm-ext-toolbox@jalkhov"
cat > "$PROFILE/user.js" <<'EOF'
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.checkCompatibility", false);
user_pref("browser.startup.homepage", "about:blank");
EOF
palemoon -no-remote -profile "$PROFILE" about:blank
```

`printf` writes the proxy file without a trailing newline; a newline breaks the path.

To test hot reload by hand: edit `core/main.js`, then open the panel and press **Reload core**.
The build label must change without restarting the browser.
