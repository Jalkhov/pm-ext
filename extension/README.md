# Toolbox (M1, in progress)

The privileged add-on that pm-ext is built around.

**Working today**

- Stable `bootstrap.js` (never reloaded) plus a reloadable `core/main.js`, evaluated with a
  cache-busting query in a fresh scope.
- XUL panel (`chrome://pm-ext/content/panel.xul`) that opens ~1.5 s after start and shows the
  Pale Moon version, the UXP engine, the current core build, the number of watched projects and a log.
- Startup gate: the Pale Moon release is compared with `MIN_APP_VERSION` (kept in sync with
  `install.rdf`); below it the panel warns, reload is disabled and nothing is watched.
- Polling watcher (`core/watcher.js`, 800 ms): every add-on installed through a proxy file whose
  source root contains `pm-ext.json` is watched. Watched extensions are `js xul xml rdf css
  manifest html dtd properties json`; `.git` and `node_modules` are skipped. After a 400 ms quiet
  period the add-on is toggled with `userDisabled`, which re-runs its `bootstrap.js` from disk.
- Log at `<profile>/pmext.log`.
- Project list in the panel with its state (`watching` or `restart to load`), plus **Register
  project...** and **Unregister** (they create and remove the proxy file; loading and unloading
  still happen at the next start).

**Not there yet:** `pm-ext.json` contents (only its presence is used), toolbar entry.

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

To hot-reload the toolbox itself: edit `core/main.js`, then press **Reload core** in the panel.

## Watch a project

Install the add-on you are developing through its own proxy file and drop an empty `pm-ext.json` at
its root:

```sh
printf '%s' "$PWD/my-addon" > "$PROFILE/extensions/my-addon@example.com"
: > "$PWD/my-addon/pm-ext.json"
```

Edit any watched file and the add-on restarts without touching the browser. The panel status shows
how many projects are watched; `pmext.log` records each reload. The toolbox never watches itself.

## Manage projects

**Register project...** opens a folder picker; choose a directory that contains `install.rdf` and
`pm-ext.json`. The toolbox writes `<profile>/extensions/<id>` with that path and adds the project to
the list as `restart to load`. Restart Pale Moon once to load it; from then on it is watched.

**Unregister** removes the proxy file of the selected project and drops it from the list. The add-on
keeps running until the next restart.

Both actions only edit proxy files: UXP cannot load or unload a bootstrapped add-on on demand.
