#!/usr/bin/env bash
# Notarize + staple the already-signed .dmg. Run when Apple notarization is
# healthy (it stalled ~100min on 2026-06-14). Reads creds from .env.local.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env.local; set +a
DMG="dist/Boardroom-0.4.3-arm64.dmg"
echo "submitting $DMG to Apple notarization (this blocks until done)…"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" \
  --wait
echo "stapling ticket onto the dmg…"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG" && echo "✅ notarized + stapled — clean for distribution"
