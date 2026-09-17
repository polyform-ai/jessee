#!/bin/zsh
set -euo pipefail

repo_dir=${0:A:h:h:h}
configuration=${1:-release}
output_dir="$repo_dir/mac/build"
app_dir="$output_dir/JesSee.app"

cd "$repo_dir"
build_arguments=(-c "$configuration")
if [[ "${JESSEE_DISTRIBUTION:-0}" == "1" ]]; then
  build_arguments+=(--arch arm64 --arch x86_64)
fi
swift build "${build_arguments[@]}"
bin_dir=$(swift build "${build_arguments[@]}" --show-bin-path)

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" "$app_dir/Contents/Frameworks"
cp "$bin_dir/JesSeeApp" "$app_dir/Contents/MacOS/JesSee"
cp "$repo_dir/mac/Support/Info.plist" "$app_dir/Contents/Info.plist"

editor_dir="$repo_dir/mac/build/editor"
if [[ ! -f "$editor_dir/mac-editor.js" || ! -f "$editor_dir/mac-editor.css" ]]; then
  echo "The Mac story editor is missing. Run npm run mac:editor first." >&2
  exit 1
fi
cp "$editor_dir/mac-editor.js" "$app_dir/Contents/Resources/mac-editor.js"
cp "$editor_dir/mac-editor.css" "$app_dir/Contents/Resources/mac-editor.css"

sparkle_framework="$repo_dir/.build/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64/Sparkle.framework"
if [[ ! -d "$sparkle_framework" ]]; then
  echo "Sparkle.framework was not found after the build." >&2
  exit 1
fi
ditto "$sparkle_framework" "$app_dir/Contents/Frameworks/Sparkle.framework"
/usr/bin/install_name_tool -add_rpath @executable_path/../Frameworks "$app_dir/Contents/MacOS/JesSee"

if [[ -n "${JESSEE_VERSION:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $JESSEE_VERSION" "$app_dir/Contents/Info.plist"
fi
if [[ -n "${JESSEE_BUILD_NUMBER:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $JESSEE_BUILD_NUMBER" "$app_dir/Contents/Info.plist"
fi
if [[ -n "${JESSEE_SPARKLE_PUBLIC_KEY:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Set :SUPublicEDKey $JESSEE_SPARKLE_PUBLIC_KEY" "$app_dir/Contents/Info.plist"
fi
if [[ -n "${JESSEE_FEATURE_USAGE_ENDPOINT:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Add :PFFeatureUsageEndpoint string $JESSEE_FEATURE_USAGE_ENDPOINT" "$app_dir/Contents/Info.plist"
fi

iconset=$(mktemp -d)/JesSee.iconset
mkdir -p "$iconset"
assets="$repo_dir/mac/Support/AppIcon.appiconset"
cp "$assets/mac-icon-16@1x.png" "$iconset/icon_16x16.png"
cp "$assets/mac-icon-16@2x.png" "$iconset/icon_16x16@2x.png"
cp "$assets/mac-icon-32@1x.png" "$iconset/icon_32x32.png"
cp "$assets/mac-icon-32@2x.png" "$iconset/icon_32x32@2x.png"
cp "$assets/mac-icon-128@1x.png" "$iconset/icon_128x128.png"
cp "$assets/mac-icon-128@2x.png" "$iconset/icon_128x128@2x.png"
cp "$assets/mac-icon-256@1x.png" "$iconset/icon_256x256.png"
cp "$assets/mac-icon-256@2x.png" "$iconset/icon_256x256@2x.png"
cp "$assets/mac-icon-512@1x.png" "$iconset/icon_512x512.png"
cp "$assets/mac-icon-512@2x.png" "$iconset/icon_512x512@2x.png"
iconutil -c icns "$iconset" -o "$app_dir/Contents/Resources/JesSee.icns"

if [[ "${JESSEE_DISTRIBUTION:-0}" == "1" ]]; then
  signing_identity=${JESSEE_SIGNING_IDENTITY:-}
  if [[ -z "$signing_identity" ]]; then
    echo "Set JESSEE_SIGNING_IDENTITY to the Developer ID Application certificate hash." >&2
    exit 1
  fi
  sign_arguments=(--force --options runtime --timestamp --sign "$signing_identity")
else
  signing_identity=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' | head -1)
  if [[ -z "$signing_identity" ]]; then
    signing_identity="-"
  fi
  sign_arguments=(--force --options runtime --sign "$signing_identity")
fi

codesign --deep "${sign_arguments[@]}" "$app_dir/Contents/Frameworks/Sparkle.framework"
codesign "${sign_arguments[@]}" --entitlements "$repo_dir/mac/Support/JesSee.entitlements" --identifier ai.polyform.jessee.mac "$app_dir"
codesign --verify --deep --strict "$app_dir"
if ! otool -l "$app_dir/Contents/MacOS/JesSee" | grep -F '@executable_path/../Frameworks' >/dev/null; then
  echo "The packaged app cannot locate its embedded frameworks." >&2
  exit 1
fi
if [[ "${JESSEE_DISTRIBUTION:-0}" == "1" ]]; then
  architectures=$(lipo -archs "$app_dir/Contents/MacOS/JesSee")
  if [[ "$architectures" != *arm64* || "$architectures" != *x86_64* ]]; then
    echo "The distribution app must contain both arm64 and x86_64 executables." >&2
    exit 1
  fi
fi
echo "$app_dir"
