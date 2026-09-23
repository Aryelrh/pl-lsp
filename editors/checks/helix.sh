#!/usr/bin/env bash
# Drives Helix in tmux and asserts through Helix's LSP log, a written buffer and
# a captured pane. Run inside `nix shell nixpkgs#helix nixpkgs#tmux -c ...`.
# Expects: PLACITUM_FILE (E301 fixture) and PLACITUM_CLEAN (clean fixture).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tmp="$(mktemp -d)"
mkdir -p "$tmp/helix"
cp "$here/../helix/languages.toml" "$tmp/helix/languages.toml"
export XDG_CONFIG_HOME="$tmp"
trap 'tmux kill-server 2>/dev/null || true; rm -rf "$tmp"' EXIT

status=0
report() { # report <ok> <label>
  if [ "$1" = 1 ]; then echo "PASS $2"; else echo "FAIL $2"; status=1; fi
}

# --- diagnostics + dynamic registration on an uncovered E301 -----------------
rm -f "$tmp/e301.log"
tmux new-session -d -s hx-e301 -x 160 -y 45 "hx -vvv --log $tmp/e301.log $PLACITUM_FILE"
sleep 6
grep -q 'E301_EXTRACT_UNCOVERED_CAPABILITY' "$tmp/e301.log" && report 1 "E301 published" || report 0 "E301 published"
grep -q 'client/registerCapability' "$tmp/e301.log" && report 1 "watcher registered" || report 0 "watcher registered"
tmux kill-session -t hx-e301

# --- hover + scope-aware rename on a shadowing fixture -----------------------
printf 'let x = 1\nfn f(x) {\n  return x\n}\nlet y = x\n' > "$tmp/shadow.placitum"
rm -f "$tmp/shadow.log" "$tmp/renamed.placitum"
tmux new-session -d -s hx-shadow -x 160 -y 45 "hx -vvv --log $tmp/shadow.log $tmp/shadow.placitum:3:10"
sleep 6
tmux send-keys -t hx-shadow Space k
sleep 3
grep -q 'textDocument/hover' "$tmp/shadow.log" && report 1 "hover requested" || report 0 "hover requested"
tmux send-keys -t hx-shadow Escape
tmux send-keys -t hx-shadow Space r
sleep 2
tmux send-keys -t hx-shadow C-w
tmux send-keys -t hx-shadow z
tmux send-keys -t hx-shadow Enter
sleep 3
tmux send-keys -t hx-shadow ":w $tmp/renamed.placitum"
tmux send-keys -t hx-shadow Enter
sleep 2
tmux kill-session -t hx-shadow
grep -q '  return z' "$tmp/renamed.placitum" && report 1 "rename applied" || report 0 "rename applied"
grep -q 'let y = x' "$tmp/renamed.placitum" && report 1 "outer binding untouched" || report 0 "outer binding untouched"

# --- manifest via :lsp-workspace-command (executeCommand without arguments) --
rm -f "$tmp/manifest.log"
tmux new-session -d -s hx-manifest -x 160 -y 45 "hx -vvv --log $tmp/manifest.log $PLACITUM_CLEAN"
sleep 6
tmux send-keys -t hx-manifest ":lsp-workspace-command"
tmux send-keys -t hx-manifest Enter
sleep 2
tmux send-keys -t hx-manifest showManifest
sleep 2
tmux send-keys -t hx-manifest Enter
sleep 4
tmux capture-pane -p -t hx-manifest > "$tmp/pane.txt"
tmux kill-session -t hx-manifest
grep -q 'grants (statically proven):' "$tmp/pane.txt" && report 1 "manifest command" || report 0 "manifest command"

exit "$status"
