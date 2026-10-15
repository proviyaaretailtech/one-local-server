#!/usr/bin/env bash
# Publishes the OneLocal customer app (Android APK) as the newest GitHub release, so every download
# link (onelocal.co → /download → releases/latest/download/onelocal.apk) serves this build.
#
#   scripts/publish-apk.sh                 # the latest FINISHED Android EAS build
#   scripts/publish-apk.sh <eas-build-id>  # a specific EAS build
#   scripts/publish-apk.sh path/to/app.apk # an APK built locally
#
# The releases repository holds APK files only, never source code. Needs: gh (signed in as an account
# that can write to proviyaaretailtech/onelocal-app-releases), eas-cli, curl, python3.
set -euo pipefail
REPO="proviyaaretailtech/onelocal-app-releases"
cd "$(dirname "$0")/.."
work="$(mktemp -d)"; trap 'rm -rf -- "$work"' EXIT
apk="$work/onelocal.apk"

if [[ "${1:-}" == *.apk ]]; then
  cp -- "$1" "$apk"; label="local build $(date +%Y%m%d-%H%M)"; tag="v$(node -p "require('./app.json').expo.version")-local-$(date +%Y%m%d%H%M)"
else
  json="$(npx eas-cli build:list --platform android --status finished --limit 20 --json --non-interactive)"
  read -r id url version made < <(python3 -c '
import json, sys
want = sys.argv[1]
for b in json.loads(sys.stdin.read()):
    url = (b.get("artifacts") or {}).get("buildUrl") or (b.get("artifacts") or {}).get("applicationArchiveUrl") or ""
    if url.endswith(".apk") and (not want or b["id"].startswith(want)):
        print(b["id"], url, b.get("appVersion", "0"), b["createdAt"][:10]); break
else:
    sys.exit("No finished Android APK build found" + (" for " + want if want else ""))
' "${1:-}" <<<"$json")
  curl -fsSL "$url" -o "$apk"
  label="EAS build ${id:0:8} ($made)"; tag="v$version-${id:0:8}"
fi

if gh release view "$tag" -R "$REPO" >/dev/null 2>&1; then echo "Release $tag already published."; exit 0; fi
gh release create "$tag" "$apk" -R "$REPO" --latest \
  --title "OneLocal ${tag#v} (Android)" \
  --notes "OneLocal customer app for Android, $label. Later fixes arrive over the air when the app opens."
echo "Published $tag → https://github.com/$REPO/releases/latest/download/onelocal.apk"
