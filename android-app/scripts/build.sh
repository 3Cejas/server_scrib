#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$APP_DIR/.." && pwd)"
SDK_DIR="${SCRIB_ANDROID_SDK:-}"
MODE="${1:-debug}"
VERSION_NAME="1.0.0"
VERSION_CODE="1"
if [[ "$MODE" != debug && "$MODE" != --release ]]; then echo 'Uso: build.sh [--release]' >&2; exit 2; fi
if [[ -z "$SDK_DIR" ]]; then echo 'Define SCRIB_ANDROID_SDK con el SDK Android 35.' >&2; exit 2; fi
TOOLS="$SDK_DIR/build-tools/35.0.0"
ANDROID_JAR="$SDK_DIR/platforms/android-35/android.jar"
for required in "$ANDROID_JAR" "$TOOLS/aapt2" "$TOOLS/d8" "$TOOLS/zipalign" "$TOOLS/apksigner"; do
  [[ -f "$required" ]] || { echo "Falta $required" >&2; exit 2; }
done
if [[ "$MODE" == --release ]]; then
  SIGNING_DIR="${SCRIB_SIGNING_DIR:?Define SCRIB_SIGNING_DIR con la carpeta privada de firma}"
  KEYSTORE="$SIGNING_DIR/scrib-release.jks"
  PASSWORD="$SIGNING_DIR/keystore-password"
  [[ -f "$KEYSTORE" && -f "$PASSWORD" ]] || { echo 'Falta la firma privada SCRIB.' >&2; exit 2; }
fi
mkdir -p "$APP_DIR/build/outputs" "$APP_DIR/res/drawable"
TEMP_DIR="$(mktemp -d "$APP_DIR/build/intermediates.XXXXXX")"
mkdir -p "$TEMP_DIR/generated" "$TEMP_DIR/classes" "$TEMP_DIR/dex"
cp "$REPO_DIR/tools/scrib-world/assets/scrib-world-logo.png" "$APP_DIR/res/drawable/scrib_logo.png"
"$TOOLS/aapt2" compile --dir "$APP_DIR/res" -o "$TEMP_DIR/resources.zip"
ARGS=(); [[ "$MODE" != debug ]] || ARGS+=(--debug-mode)
"$TOOLS/aapt2" link -o "$TEMP_DIR/app.apk" -I "$ANDROID_JAR" --manifest "$APP_DIR/AndroidManifest.xml" \
  --java "$TEMP_DIR/generated" --min-sdk-version 26 --target-sdk-version 35 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "${ARGS[@]}" "$TEMP_DIR/resources.zip"
mapfile -t SOURCES < <(rg --files "$APP_DIR/src" "$TEMP_DIR/generated" -g '*.java')
javac -encoding UTF-8 -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$TEMP_DIR/classes" "${SOURCES[@]}"
jar cf "$TEMP_DIR/classes.jar" -C "$TEMP_DIR/classes" .
"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 26 --output "$TEMP_DIR/dex" "$TEMP_DIR/classes.jar"
jar uf "$TEMP_DIR/app.apk" -C "$TEMP_DIR/dex" classes.dex
"$TOOLS/zipalign" -f 4 "$TEMP_DIR/app.apk" "$TEMP_DIR/aligned.apk"
if [[ "$MODE" == --release ]]; then
  OUTPUT="$APP_DIR/build/outputs/scrib-android-$VERSION_NAME.apk"
  "$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias scrib --ks-pass "file:$PASSWORD" --out "$OUTPUT" "$TEMP_DIR/aligned.apk"
else
  KEY_DIR="$APP_DIR/.debug-signing";mkdir -p "$KEY_DIR";chmod 700 "$KEY_DIR"
  if [[ ! -f "$KEY_DIR/debug.keystore" ]]; then
    keytool -genkeypair -keystore "$KEY_DIR/debug.keystore" -storepass android -keypass android -alias androiddebugkey \
      -dname 'CN=SCRIB Debug,O=Sutura Teatro,C=ES' -keyalg RSA -keysize 2048 -validity 10000
  fi
  OUTPUT="$APP_DIR/build/outputs/scrib-android-$VERSION_NAME-debug.apk"
  "$TOOLS/apksigner" sign --ks "$KEY_DIR/debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$OUTPUT" "$TEMP_DIR/aligned.apk"
fi
"$TOOLS/apksigner" verify --verbose "$OUTPUT"
if [[ "$MODE" == --release ]]; then
  PUBLISH_DIR="$REPO_DIR/tools/scrib-world/assets/android";mkdir -p "$PUBLISH_DIR"
  cp "$OUTPUT" "$PUBLISH_DIR/scrib.apk"
  python3 -c 'import hashlib,json,sys;from pathlib import Path;p=Path(sys.argv[1]);(p/"version.json").write_text(json.dumps({"version":sys.argv[2],"versionCode":int(sys.argv[3]),"package":"es.suturateatro.scrib","sha256":hashlib.sha256((p/"scrib.apk").read_bytes()).hexdigest()},indent=2)+"\n")' "$PUBLISH_DIR" "$VERSION_NAME" "$VERSION_CODE"
fi
echo "$OUTPUT"
