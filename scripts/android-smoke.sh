#!/usr/bin/env bash
# تست راه‌اندازی: APK را روی امولاتور نصب و باز می‌کند و اگر اپ کرش کند، لاگ را نگه می‌دارد.
set -u
PKG="ir.pptsaz.app"
APK="twa/app-release-signed.apk"

adb wait-for-device
adb logcat -c
adb install -r "$APK" || { echo "::error::نصب APK ناموفق بود"; exit 1; }

adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25

adb logcat -d > android-logcat.txt
adb logcat -d -b crash > android-crash.txt 2>/dev/null || true

if grep -q "FATAL EXCEPTION" android-logcat.txt || [ -s android-crash.txt ]; then
  echo "::error::اپ هنگام اجرا کرش کرد؛ فایل android-crash.txt را از Artifacts ببینید"
  echo "----- crash -----"
  grep -A 25 "FATAL EXCEPTION" android-logcat.txt | head -80
  exit 1
fi

if ! adb shell pidof "$PKG" >/dev/null 2>&1; then
  echo "::warning::پردازش اپ بعد از اجرا دیده نشد (ممکن است بسته شده باشد)"
fi
echo "اپ بدون کرش اجرا شد"
