#!/bin/bash
# Post-build: re-sign Diane with hardened runtime + secure timestamp +
# entitlements (Apple notarization requires all three; Tauri's own
# signing pass does not harden the runtime), then rebuild the DMG
# with an /Applications symlink. Run after `npm run tauri build`.
#
# Modelled on the proven Stash/Libre post-build, minus their
# companion-app embed (Diane has none). Identity defaults to the
# shared Developer ID; override with SIGN_IDENTITY=… or =- (ad-hoc,
# not notarizable).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"

APP_BUNDLE=$(find "$TAURI_DIR/target/release/bundle/macos" \
    -maxdepth 1 -name "*.app" 2>/dev/null | head -1)
if [ -z "$APP_BUNDLE" ]; then
    echo "No .app in target/release/bundle/macos — nothing to sign"
    exit 0
fi

# Shared "Developer ID Application: Matt Wisniewski (F6ZAL7ANAD)".
IDENTITY="${SIGN_IDENTITY:-0948896DC970503ADEF5B5070E0BB3E9D9047757}"
ENTITLEMENTS="$TAURI_DIR/Entitlements.plist"
MAIN=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
    "$APP_BUNDLE/Contents/Info.plist")

echo "=== Signing $APP_BUNDLE ($IDENTITY) ==="

if [ "$IDENTITY" = "-" ]; then
    # Local ad-hoc: runs on this Mac, cannot be notarized.
    codesign --force --deep --sign - "$APP_BUNDLE" || true
else
    # Any nested Mach-O (frameworks/helpers) first, innermost-out,
    # then the main binary, then the outer bundle last so the seal
    # covers everything.
    while IFS= read -r f; do
        codesign --force --options runtime --timestamp \
            --sign "$IDENTITY" "$f" 2>/dev/null || true
    done < <(find "$APP_BUNDLE/Contents" \
        \( -name "*.dylib" -o -path "*/Frameworks/*" \) -type f 2>/dev/null)

    codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" \
        --entitlements "$ENTITLEMENTS" \
        "$APP_BUNDLE/Contents/MacOS/$MAIN"
    echo "Signed: $MAIN"

    codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" \
        --entitlements "$ENTITLEMENTS" \
        "$APP_BUNDLE"
    echo "Signed: $APP_BUNDLE"
fi

echo "=== Verification ==="
codesign --verify --deep --strict "$APP_BUNDLE" \
    && echo "Signature valid" \
    || echo "WARNING: signature verification failed"

# Rebuild the DMG around the freshly signed app (Tauri built it
# around the unsigned one) with the drag-to-install symlink.
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
VERSION=$(node -e \
    "console.log(require('$TAURI_DIR/tauri.conf.json').version)" \
    2>/dev/null || echo "0.0.0")
DMG_PATH="$DMG_DIR/Diane_${VERSION}_aarch64.dmg"
if [ -d "$DMG_DIR" ]; then
    echo "=== Rebuilding DMG ==="
    rm -f "$DMG_PATH"
    STAGE=$(mktemp -d)
    cp -R "$APP_BUNDLE" "$STAGE/"
    ln -s /Applications "$STAGE/Applications"
    hdiutil create -volname "Diane" -srcfolder "$STAGE" \
        -ov -format UDZO "$DMG_PATH" >/dev/null
    rm -rf "$STAGE"
    [ "$IDENTITY" != "-" ] && codesign --force --sign "$IDENTITY" \
        "$DMG_PATH" || true
    echo "DMG: $DMG_PATH"
fi

echo "=== Post-build complete — next: make notarize ==="
