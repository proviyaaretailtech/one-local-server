#!/usr/bin/env bash
# Launch check for an Android build: installs the APK on the running emulator (or an attached phone), clears its
# data, opens it like a new customer, walks language → Latur → Discover → Home, cold-restarts it (no intro the
# second time, straight to the app), and fails if the app crashed,
# showed the "Something went wrong" screen, or could not reach a screen. Run it on every APK before anyone else installs it — a web
# check does not catch Android-only failures (module load order, native modules, the press wrapper in src/native/).
#
#   scripts/android-smoke.sh path/to/app.apk [seconds=30] [screenshot.png]
#   EXPECT_POPUP=1 scripts/android-smoke.sh …   also fails when no pop-up opens over Home on the first open (set it when
#                                                a campaign is live on the server the build talks to)
#
# A Play .aab cannot be installed directly: make one APK from it first (bundletool build-apks --mode=universal, signed
# with ~/.android/debug.keystore) and check that.
#
# Start an emulator first: "$ANDROID_HOME/emulator/emulator" -avd Pixel_7
# On an emulator a build signed with another key is uninstalled first (its test data goes); on a real phone
# the script stops instead, so nobody's data is wiped.
set -euo pipefail
apk="${1:?usage: android-smoke.sh app.apk [seconds] [screenshot.png]}"; wait_s="${2:-30}"; shot="${3:-}"
pkg=com.proviyaa.onelatur
adb="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"

"$adb" get-state >/dev/null 2>&1 || { echo "FAIL: no emulator or phone attached"; exit 2; }
emulator=$("$adb" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')

if ! out=$("$adb" install -r "$apk" 2>&1); then
  if [[ "$out" == *INSTALL_FAILED_UPDATE_INCOMPATIBLE* && "$emulator" == "1" ]]; then
    "$adb" uninstall "$pkg" >/dev/null; "$adb" install "$apk" >/dev/null
  else echo "FAIL: install: ${out##*$'\n'}"; exit 1; fi
fi
version=$("$adb" shell dumpsys package "$pkg" | grep -m1 -o 'versionCode=[0-9]*')

"$adb" shell am force-stop "$pkg"
# A first launch (intro + language). Only on an emulator: on a real phone this would wipe the person's data.
[[ "$emulator" == "1" ]] && { "$adb" shell pm clear "$pkg" >/dev/null 2>&1 || true; }
"$adb" logcat -c
"$adb" shell am start -n "$pkg/.MainActivity" >/dev/null
sleep "$wait_s"

# Tap the first on-screen element whose text or description is exactly $1 (uiautomator, so no fixed coordinates).
tap_text_once() {
  "$adb" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  local xy; xy=$("$adb" exec-out cat /sdcard/ui.xml | python3 -c '
import re, sys
want = sys.argv[1]; xml = sys.stdin.read()
for node in re.findall(r"<node [^>]*>", xml):
    if re.search(r"(text|content-desc)=\"%s\"" % re.escape(want), node):
        x1, y1, x2, y2 = map(int, re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", node).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2); break' "$1")
  [[ -n "$xy" ]] || return 1
  "$adb" shell input tap $xy; sleep "${2:-5}"
}
# Tap the first element whose testID (Android resource-id) starts with $1.
tap_id_once() {
  "$adb" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || return 1
  local xy; xy=$("$adb" exec-out cat /sdcard/ui.xml | python3 -c '
import re, sys
want = sys.argv[1]; xml = sys.stdin.read()
for node in re.findall(r"<node [^>]*>", xml):
    if re.search(r"resource-id=\"%s" % re.escape(want), node):
        x1, y1, x2, y2 = map(int, re.search(r"bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", node).groups())
        print((x1 + x2) // 2, (y1 + y2) // 2); break' "$1")
  [[ -n "$xy" ]] || return 1
  "$adb" shell input tap $xy; sleep "${2:-5}"
}
# Screens load at their own pace (slower on a first launch): look up to 4 times, 3 s apart.
tap_text() { for _ in 1 2 3 4; do tap_text_once "$@" && return 0; sleep 3; done; echo "  (could not find \"$1\" on screen)"; return 1; }
tap_id() { for _ in 1 2 3 4; do tap_id_once "$@" && return 0; sleep 3; done; echo "  (could not find id \"$1*\" on screen)"; return 1; }
# The path a new customer takes, ending by leaving Discover (its videos are released on the way out).
walk="ok"
tap_text "Continue" 5 || walk="incomplete"
tap_text "Latur" 8 || walk="incomplete"
# First time on Home a signed-out customer is offered sign-in once (src/components/sign-in-prompt.tsx): skip it.
tap_id "sign-in-skip" 6 || walk="sign-in was not offered on first open"
# A promotional pop-up opens over Home a few seconds later when a campaign is live; close it. With EXPECT_POPUP=1 a
# missing pop-up fails the check.
if [[ "${EXPECT_POPUP:-0}" == 1 ]]; then tap_id "popup-close" 3 || walk="no pop-up opened over Home on first open"
else tap_id_once "popup-close" 3 || true; fi
tap_id "tab-reels" 8 || walk="incomplete"   # Discover (the round button; its label is not tappable)
# Discover's playing tile videos never let the screen go idle, so uiautomator cannot read it ("could not get idle
# state") and its tiles cannot be found by id. Open the reels with a link instead: Discover loses focus and releases
# every tile video, as with a tap on a tile. Back returns to Discover.
"$adb" shell am start -a android.intent.action.VIEW -d "onecity://reels" "$pkg" >/dev/null; sleep 6
"$adb" shell input keyevent 4; sleep 4
# Scroll Discover down and back up: playing tiles scroll out of view and their video players are released.
for dir in up up down down; do
  if [[ $dir == up ]]; then "$adb" shell input swipe 540 1900 540 900 300; else "$adb" shell input swipe 540 900 540 1900 300; fi; sleep 3
done
# Back again leaves Discover for Home (the tab bar goes back through its history).
"$adb" shell input keyevent 4; sleep 4
tap_id "tab-home" 5 || walk="incomplete"
tap_id_once "popup-close" 3 || true

# Second launch: the intro video plays once per install, so a cold restart must go straight from the native splash
# to the app (no intro, no language chooser).
"$adb" shell am force-stop "$pkg"; "$adb" shell am start -n "$pkg/.MainActivity" >/dev/null; sleep 6
"$adb" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
second=$("$adb" exec-out cat /sdcard/ui.xml 2>/dev/null || true)
if [[ "$second" == *'resource-id="intro-splash"'* ]]; then walk="intro replayed on second launch"
elif [[ "$second" == *'resource-id="sign-in-skip"'* ]]; then walk="sign-in offered again on second launch"
elif [[ "$second" != *'resource-id="tab-home'* ]]; then walk="second launch did not reach the app"; fi

crash=$("$adb" logcat -d -b crash 2>/dev/null | grep -A3 "Process: $pkg" | head -4 || true)
# "Something went wrong" keeps the process alive, so the error boundary's log line counts as a failure too.
boundary=$("$adb" logcat -d 2>/dev/null | grep -m3 -E "ErrorBoundary\]|render crash" || true)
js=$("$adb" logcat -d 2>/dev/null | grep -E "E ReactNativeJS" | head -3 || true)
pid=$("$adb" shell pidof "$pkg" 2>/dev/null | tr -d '\r' || true)
[[ -n "$shot" ]] && "$adb" exec-out screencap -p > "$shot"

if [[ -n "$crash" || -n "$boundary" || -z "$pid" ]]; then
  echo "FAIL: $pkg ($version) crashed, showed the error screen, or closed (walk: $walk)"
  [[ -n "$crash" ]] && echo "$crash"
  [[ -n "$boundary" ]] && echo "$boundary"
  [[ -n "$js" ]] && echo "$js"
  exit 1
fi
[[ "$walk" == "ok" ]] || { echo "FAIL: $pkg ($version) stayed up but the walk failed: $walk"; exit 1; }
echo "PASS: $pkg ($version) first launch, language, Latur, the one-time sign-in offer,$([[ "${EXPECT_POPUP:-0}" == 1 ]] && echo " the Home pop-up,") Discover and a reel, Home, and a second launch with no intro or sign-in offer, with no crash or error screen"
[[ -n "$js" ]] && { echo "JS errors logged (app kept running):"; echo "$js"; }
exit 0
