#!/bin/zsh
set -euo pipefail

repo_dir=${0:A:h:h:h}
version=${1:-}
build_number=${2:-}

if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.]+)?$' ]]; then
  echo "Usage: mac/Support/package-release.sh <version> <build-number>" >&2
  exit 2
fi
if [[ ! "$build_number" =~ '^[0-9]+$' ]]; then
  echo "The build number must be a positive integer." >&2
  exit 2
fi
if [[ -z "${JESSEE_SIGNING_IDENTITY:-}" ]]; then
  echo "Set JESSEE_SIGNING_IDENTITY to the Developer ID Application certificate hash." >&2
  exit 1
fi
updates_dir="$repo_dir/mac/build/releases"
installers_dir="$repo_dir/mac/build/installers"
app_dir="$repo_dir/mac/build/JesSee.app"
archive_path="$updates_dir/JesSee-$version.zip"
dmg_path="$installers_dir/JesSee.dmg"
notes_path="$updates_dir/JesSee-$version.md"
appcast_path="$updates_dir/appcast.xml"
sparkle_dir="$repo_dir/.build/artifacts/sparkle/Sparkle/bin"
scratch_dir=$(mktemp -d /tmp/jessee-release.XXXXXX)
trap 'rm -rf "$scratch_dir"' EXIT

notary_submit() {
  local artifact=$1
  if [[ -n "${JESSEE_NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$artifact" --keychain-profile "$JESSEE_NOTARY_PROFILE" --wait
  elif [[ -n "${APPLE_NOTARY_KEY_PATH:-}" && -n "${APPLE_NOTARY_KEY_ID:-}" && -n "${APPLE_NOTARY_ISSUER_ID:-}" ]]; then
    xcrun notarytool submit "$artifact" \
      --key "$APPLE_NOTARY_KEY_PATH" \
      --key-id "$APPLE_NOTARY_KEY_ID" \
      --issuer "$APPLE_NOTARY_ISSUER_ID" \
      --wait
  else
    echo "Set JESSEE_NOTARY_PROFILE or the APPLE_NOTARY_KEY_PATH, APPLE_NOTARY_KEY_ID, and APPLE_NOTARY_ISSUER_ID variables." >&2
    exit 1
  fi
}

cd "$repo_dir"
JESSEE_DISTRIBUTION=1 \
  JESSEE_VERSION="$version" \
  JESSEE_BUILD_NUMBER="$build_number" \
  mac/Support/build-app.sh release

mkdir -p "$updates_dir" "$installers_dir"
rm -f "$archive_path" "$dmg_path" "$notes_path" "$appcast_path" "$updates_dir"/*.delta(N)

ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$scratch_dir/JesSee-notarization.zip"
notary_submit "$scratch_dir/JesSee-notarization.zip"
xcrun stapler staple "$app_dir"
xcrun stapler validate "$app_dir"

mkdir -p "$scratch_dir/dmg"
ditto "$app_dir" "$scratch_dir/dmg/JesSee.app"
ln -s /Applications "$scratch_dir/dmg/Applications"
hdiutil create -quiet -volname JesSee -srcfolder "$scratch_dir/dmg" -ov -format UDZO "$dmg_path"
codesign --force --timestamp --sign "$JESSEE_SIGNING_IDENTITY" "$dmg_path"
codesign --verify --verbose=2 "$dmg_path"
notary_submit "$dmg_path"
xcrun stapler staple "$dmg_path"
xcrun stapler validate "$dmg_path"
codesign --verify --verbose=2 "$dmg_path"

ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$archive_path"

if [[ -n "${JESSEE_RELEASE_NOTES_FILE:-}" ]]; then
  cp "$JESSEE_RELEASE_NOTES_FILE" "$notes_path"
else
  cat > "$notes_path" <<EOF
# JesSee $version

This release is signed by Polyform, notarized by Apple, and can update itself from inside JesSee.

- Record with a visible timer and live microphone level.
- Draw, highlight, undo, clear, redo, or stop directly from the floating controls.
- Hover recording and editor icons to see what each control does.
- Press Option-S from anywhere to stop and process the recording.
- Edit the generated story, choose alternate screenshots, mark up evidence, and export one continuous PDF.
EOF
fi

if [[ ! -x "$sparkle_dir/generate_appcast" ]]; then
  echo "Sparkle release tools were not found. Run swift package resolve first." >&2
  exit 1
fi

appcast_arguments=(
  --download-url-prefix "https://github.com/polyform-ai/jessee/releases/download/v$version/"
  --link "https://jessee.ai/"
  --embed-release-notes
  --maximum-versions 1
  -o "$appcast_path"
  "$updates_dir"
)
if [[ -n "${SPARKLE_PRIVATE_KEY:-}" ]]; then
  print -rn -- "$SPARKLE_PRIVATE_KEY" | "$sparkle_dir/generate_appcast" --ed-key-file - "${appcast_arguments[@]}"
else
  "$sparkle_dir/generate_appcast" --account polyform-jessee "${appcast_arguments[@]}"
fi

codesign --verify --deep --strict --verbose=2 "$app_dir"
spctl --assess --type execute --verbose=2 "$app_dir"

echo "$dmg_path"
echo "$archive_path"
echo "$appcast_path"
