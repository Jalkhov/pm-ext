#!/usr/bin/env bash
# M0 proof of concept: launch Pale Moon with an isolated dev profile where the
# target and driver add-ons are installed via proxy files, then show the result.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M0="$ROOT/examples/m0"
PROFILE="${PM_EXT_PROFILE:-$ROOT/.dev-profile}"
PALEMOON="${PALEMOON:-palemoon}"

if [ ! -d "$PROFILE" ]; then
  mkdir -p "$PROFILE"
fi

cat > "$PROFILE/user.js" <<'EOF'
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.checkCompatibility", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage", "about:blank");
user_pref("app.update.enabled", false);
EOF

mkdir -p "$PROFILE/extensions"
printf '%s' "$M0/target" > "$PROFILE/extensions/pm-ext-m0-target@example.com"
printf '%s' "$M0/driver" > "$PROFILE/extensions/pm-ext-m0-driver@example.com"

rm -f "$PROFILE/m0-driver.log" "$PROFILE/m0-target-last.log"
"$PALEMOON" -no-remote -profile "$PROFILE" about:blank || true

cat "$PROFILE/m0-driver.log"
