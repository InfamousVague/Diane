# Diane — Build, Sign, Notarize, Install
#
# Brings Diane to notarization parity with the rest of the suite.
# Unlike Stash/Libre this uses the `Notary` notarytool keychain
# profile (already set up on this machine, used by the Swift suite)
# — no .env.apple / plaintext app-specific password needed.
#
#   make            full pipeline: build → sign → notarize → install
#   make build      tauri release build (npm install if needed)
#   make sign       post-build hardened-runtime re-sign + rebuild DMG
#   make notarize   submit the DMG to Apple + staple
#   make install    install the notarized app to /Applications
#   make release    bump patch, build, notarize, GitHub release
#   make clean      remove build artifacts
#
# Override the notary profile with NOTARY_PROFILE=… ; force an
# ad-hoc local (non-notarizable) build with SIGN_IDENTITY=-.

SHELL := /bin/bash
ROOT  := $(shell pwd)
TAURI := $(ROOT)/src-tauri

NOTARY_PROFILE ?= Notary
VERSION := $(shell node -e "console.log(require('$(TAURI)/tauri.conf.json').version)" 2>/dev/null || echo 0.0.0)
DMG     := $(TAURI)/target/release/bundle/dmg/Diane_$(VERSION)_aarch64.dmg
APP     := $(TAURI)/target/release/bundle/macos/Diane.app
INSTALL := /Applications/Diane.app

.PHONY: all build sign notarize staple install release clean help

all: build sign notarize install
	@echo ""
	@echo "✓ Done — Diane $(VERSION) installed and notarized"

build:
	@echo "=== Building Diane $(VERSION) ==="
	@[ -d node_modules ] || npm install
	npm run tauri build -- --bundles app,dmg

sign:
	@echo "=== Signing (hardened runtime) ==="
	cd $(TAURI) && bash scripts/post-build.sh

notarize:
	@echo "=== Notarizing $(DMG) ==="
	@[ -f "$(DMG)" ] || { echo "✗ $(DMG) not found — run make build sign"; exit 1; }
	xcrun notarytool submit "$(DMG)" \
		--keychain-profile "$(NOTARY_PROFILE)" --wait
	xcrun stapler staple "$(DMG)"
	xcrun stapler validate "$(DMG)" && echo "✓ notarized + stapled"

staple:
	xcrun stapler staple "$(DMG)"

install:
	@echo "=== Installing to $(INSTALL) ==="
	@MP=$$(mktemp -d); \
	 hdiutil attach "$(DMG)" -quiet -nobrowse -mountpoint "$$MP"; \
	 rm -rf "$(INSTALL)"; \
	 ditto "$$MP/Diane.app" "$(INSTALL)"; \
	 hdiutil detach "$$MP" -quiet; \
	 rmdir "$$MP" 2>/dev/null || true
	@spctl --assess --type execute --verbose "$(INSTALL)" 2>&1 || true
	@echo "Installed: $(INSTALL)"

# Bump patch, full notarized build, GitHub release. Mirrors the
# Stash/Libre `local-release` flow but profile-based.
release:
	@CUR=$(VERSION); IFS='.' read -r MA MI PA <<< "$$CUR"; \
	 NEW="$$MA.$$MI.$$((PA+1))"; \
	 echo "=== Diane $$CUR → $$NEW ==="; \
	 sed -i '' "s/\"version\": \"$$CUR\"/\"version\": \"$$NEW\"/" src-tauri/tauri.conf.json; \
	 sed -i '' "s/^version = \"$$CUR\"/version = \"$$NEW\"/" src-tauri/Cargo.toml; \
	 git add src-tauri/tauri.conf.json src-tauri/Cargo.toml; \
	 git commit -m "Diane v$$NEW" >/dev/null; \
	 $(MAKE) build sign notarize; \
	 DMG="$(TAURI)/target/release/bundle/dmg/Diane_$${NEW}_aarch64.dmg"; \
	 git tag -a "v$$NEW" -m "Diane v$$NEW"; \
	 git push origin HEAD; git push origin "v$$NEW"; \
	 gh release create "v$$NEW" "$$DMG" --title "Diane v$$NEW" \
	   --notes "Signed and Apple-notarized macOS release." --latest; \
	 echo "✓ Diane v$$NEW released"

clean:
	rm -rf $(TAURI)/target/release/bundle
	@echo "Cleaned"

help:
	@echo "make [all|build|sign|notarize|install|release|clean]"
