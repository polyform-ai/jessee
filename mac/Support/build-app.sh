#!/bin/zsh
set -euo pipefail

repo_dir=${0:A:h:h:h}
configuration=${1:-release}
output_dir="$repo_dir/mac/build"
app_dir="$output_dir/JesSee.app"

cd "$repo_dir"
swift build -c "$configuration"
bin_dir=$(swift build -c "$configuration" --show-bin-path)

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$bin_dir/JesSeeApp" "$app_dir/Contents/MacOS/JesSee"
cp "$repo_dir/mac/Support/Info.plist" "$app_dir/Contents/Info.plist"

iconset=$(mktemp -d)/JesSee.iconset
mkdir -p "$iconset"
assets="$repo_dir/safari/JesSee/Assets.xcassets/AppIcon.appiconset"
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

codesign --force --options runtime --identifier ai.polyform.jessee.mac --sign - "$app_dir"
echo "$app_dir"
