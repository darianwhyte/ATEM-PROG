#!/bin/bash
# =========================================================================
# ATEM-PROG macOS Command Launcher (Double-click in Finder)
# Starts background service silently, opens Launcher UI & closes Terminal.
# =========================================================================
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$PATH"

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$APP_DIR/bridge"
LAUNCHER_URL="http://127.0.0.1:8993/launcher.html"

# Ensure the bundled macOS .app is also executable
chmod +x "$APP_DIR/ATEM-PROG.app/Contents/MacOS/ATEM-PROG" 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
    echo "Node.js not found — opening ATEM-PROG in standalone offline mode..."
    open "$APP_DIR/ATEM-PROG.html"
    exit 0
fi

if [ ! -d "$BRIDGE_DIR/node_modules/ws" ] || [ ! -d "$BRIDGE_DIR/node_modules/atem-connection" ]; then
    echo "First-time setup: installing ATEM-PROG service dependencies..."
    (cd "$BRIDGE_DIR" && npm install --no-audit --no-fund)
fi

if ! curl -sf --max-time 1 "http://127.0.0.1:8993/api/status" >/dev/null 2>&1; then
    (cd "$BRIDGE_DIR" && nohup node server.js >/tmp/atem-prog-bridge.log 2>&1 &)
    for i in $(seq 1 25); do
        sleep 0.15
        if curl -sf --max-time 1 "http://127.0.0.1:8993/api/status" >/dev/null 2>&1; then
            break
        fi
    done
fi

if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$LAUNCHER_URL" --window-size=640,740
elif [ -d "/Applications/Microsoft Edge.app" ]; then
    open -na "Microsoft Edge" --args --app="$LAUNCHER_URL" --window-size=640,740
elif [ -d "/Applications/Brave Browser.app" ]; then
    open -na "Brave Browser" --args --app="$LAUNCHER_URL" --window-size=640,740
else
    open "$LAUNCHER_URL"
fi

# Cleanly close the macOS Terminal window that spawned this script
osascript -e 'tell application "Terminal" to close (every window whose name contains "Launch-ATEM-PROG")' >/dev/null 2>&1 || true
exit 0
