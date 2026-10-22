#!/usr/bin/env bash
# تست دود روی امولاتور: نصب، اجرا، نبودن کرش، اسکرین‌شات
set -u
APK="${1:?apk path}"
PKG=ir.pptsaz.app
OUT="${2:-smoke-out}"
mkdir -p "$OUT"
adb logcat -c
adb install -r "$APK" || { echo "INSTALL FAILED"; exit 1; }
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 20
adb exec-out screencap -p > "$OUT/screen.png" || true
adb logcat -d > "$OUT/logcat.txt"
if ! adb shell pidof "$PKG" >/dev/null 2>&1; then
  echo "APP NOT RUNNING"; grep -n -E "FATAL|AndroidRuntime|$PKG" "$OUT/logcat.txt" | head -40; exit 1
fi
if grep -q -E "FATAL EXCEPTION.*|Process: $PKG" "$OUT/logcat.txt"; then
  echo "CRASH DETECTED"; grep -n -A12 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60; exit 1
fi
echo "OK: app is running, no crash"
