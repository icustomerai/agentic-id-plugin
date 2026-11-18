#!/usr/bin/env bash
# Check a REAL sign-in end to end, with you at the keyboard: your browser opens the real login
# page, you sign in with your own account, and this script checks what the plugin can then do.
# Nothing here asks for or prints a password, key or token.
#
#   AGENTIC_ID_URL=<the API with sign-in on> test/real-signin.sh
#
# It uses its own folder for the sign-in, so your normal one is untouched; it signs out at the end.
set -uo pipefail
: "${AGENTIC_ID_URL:?set AGENTIC_ID_URL, e.g. http://localhost:3000 or your deployed address}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; A="$ROOT/cli/agentic-id"
export AGENTIC_ID_CONFIG_DIR="$(mktemp -d)"; unset AGENTIC_ID_API_KEY AGENTIC_ID_API_KEY_FILE
trap '"$A" logout >/dev/null 2>&1; rm -rf "$AGENTIC_ID_CONFIG_DIR"' EXIT
pass=0; fail=0
ok() { echo "PASS  $1"; pass=$((pass+1)); }; bad() { echo "FAIL  $1"; fail=$((fail+1)); }

echo "1. Signed out: status should say to sign in."
"$A" status >/dev/null 2>&1; [ $? -eq 2 ] && ok "signed out is reported" || bad "expected exit 2 when signed out"

echo "2. Your browser opens now. Sign in with your iCustomer account, then come back here."
if "$A" login; then ok "login completed"; else bad "login did not complete (see the message above)"; fi

echo "3. After sign-in:"
out="$("$A" status 2>&1)"; echo "   $out" | head -1
echo "$out" | grep -q "(signed in)" && ok "status shows you signed in, with a workspace of your own" || bad "status does not show a sign-in"
mode="$(stat -f '%Lp' "$AGENTIC_ID_CONFIG_DIR/session.json" 2>/dev/null || stat -c '%a' "$AGENTIC_ID_CONFIG_DIR/session.json" 2>/dev/null)"
[ "$mode" = "600" ] && ok "the stored sign-in is readable by you only" || bad "session file mode is $mode, expected 600"
"$A" workspace 5 | head -3 | sed 's/^/   /'; [ "${PIPESTATUS[0]}" -eq 0 ] && ok "workspace and credits load" || bad "workspace failed"
"$A" discover --country GB --industry software --count 2>&1 | head -1 | cut -c1-200 | sed 's/^/   /'; [ "${PIPESTATUS[0]}" -eq 0 ] && ok "a free count works with the sign-in" || bad "the free count failed"

echo "4. Sign out."
"$A" logout >/dev/null 2>&1; "$A" status >/dev/null 2>&1; [ $? -eq 2 ] && ok "signed out again" || bad "still signed in after logout"

echo; echo "$pass passed, $fail failed"; [ "$fail" -eq 0 ]
