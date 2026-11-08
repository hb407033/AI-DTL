#!/bin/sh
# 用公司团队（W4B64PJH42）的通配开发描述文件签名并安装 iPad 正式版（Release）。
# 经用户确认公司允许（2026-11-08）。手动签名，不让 Xcode 在公司账号里注册 App ID、设备或证书。
# 描述文件到期：2027-10-07（管理员吊销证书、移除设备或公司不续费时会提前失效）。
# 同一团队签名可直接覆盖安装，App 数据保留；换团队签名才需要卸载重装。
set -eu
cd "$(dirname "$0")/../apps/ipad/ScholarPad"
DEVICE=00008112-000509D9268A201E
IDENTITY=73CD97B30B4BA2E4EF126913CE57A84EA3225188   # Apple Development: 斌 侯，包含在公司通配描述文件里
PROFILE="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/6011cc9b-58ed-4965-bd31-8b6cef28ab9f.mobileprovision"
OUT=$(mktemp -d); trap 'rm -rf "$OUT"' EXIT
[ -f "$PROFILE" ] || { echo "找不到公司通配描述文件：$PROFILE"; exit 1; }
xcodegen generate >/dev/null
xcodebuild build -project ScholarPad.xcodeproj -target ScholarPad -configuration Release -sdk iphoneos \
  SYMROOT="$OUT/build" OBJROOT="$OUT/obj" CODE_SIGNING_ALLOWED=NO | grep -E "error:|BUILD" | tail -3
APP="$OUT/build/Release-iphoneos/ScholarPad.app"
cat > "$OUT/app.entitlements" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>W4B64PJH42.com.houbin.aischolar.pad</string>
  <key>com.apple.developer.team-identifier</key><string>W4B64PJH42</string>
  <key>get-task-allow</key><true/>
  <key>keychain-access-groups</key><array><string>W4B64PJH42.com.houbin.aischolar.pad</string></array>
</dict></plist>
PLIST
cp "$PROFILE" "$APP/embedded.mobileprovision"
codesign --force --sign "$IDENTITY" --entitlements "$OUT/app.entitlements" --timestamp=none --generate-entitlement-der "$APP"
codesign --verify --deep --strict "$APP"
echo "描述文件到期：$(security cms -D -i "$APP/embedded.mobileprovision" | plutil -extract ExpirationDate raw -o - -)"
xcrun devicectl device install app --device "$DEVICE" "$APP" | grep -E "App installed|rror"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing com.houbin.aischolar.pad | tail -1
