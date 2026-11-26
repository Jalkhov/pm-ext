#!/usr/bin/env bash
# Runs the toolbox in a throwaway profile and checks the panel end to end.
# Usage: tests/integration/run.sh   (PALEMOON=... to use another binary)
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=${PMEXT_WORK:-/tmp/pmext-integration}
PROFILE=${PMEXT_PROFILE:-/tmp/pmext-integration-profile}
BIN=${PALEMOON:-palemoon}

rm -rf "$WORK" "$PROFILE"
mkdir -p "$WORK" "$PROFILE/extensions"
# A copy, so the test can edit the target without dirtying the repo.
cp -R "$ROOT/examples/m0/target" "$WORK/target"
: > "$WORK/target/pm-ext.json"

cat > "$PROFILE/user.js" <<'EOF'
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.checkCompatibility", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage", "about:blank");
user_pref("app.update.enabled", false);
EOF

# Proxy files: the toolbox, the driver, and two registered projects.
printf '%s' "$ROOT/extension" > "$PROFILE/extensions/pm-ext-toolbox@jalkhov"
printf '%s' "$ROOT/tests/integration/driver" > "$PROFILE/extensions/pm-ext-integration@jalkhov"
printf '%s' "$WORK/target" > "$PROFILE/extensions/pm-ext-m0-target@example.com"
printf '%s' "$ROOT/tests/integration/fixtures/second" > "$PROFILE/extensions/pm-ext-second@example.com"

timeout 120 "$BIN" -no-remote -profile "$PROFILE" about:blank || true

cat "$PROFILE/integration.log"
grep -q "RESULT: PASS" "$PROFILE/integration.log"
