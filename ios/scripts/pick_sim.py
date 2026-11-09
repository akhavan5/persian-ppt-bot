#!/usr/bin/env python3
"""UDID یک شبیه‌ساز iPhone موجود را چاپ می‌کند. با --large ترجیح با بزرگ‌ترین مدل (Pro Max) است، مناسب اسکرین‌شات‌های فروشگاه."""
import json
import subprocess
import sys

large = "--large" in sys.argv
data = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"]))["devices"]
cands = []
for runtime, devs in data.items():
    if "iOS" not in runtime:
        continue
    for d in devs:
        if d.get("isAvailable") and d["name"].startswith("iPhone"):
            cands.append((runtime, d["name"], d["udid"]))
if not cands:
    sys.exit("no iPhone simulator available")


def score(c):
    runtime, name, _ = c
    s = 0
    if large:
        if "Pro Max" in name:
            s += 100
        elif "Plus" in name:
            s += 50
    return (s, runtime, name)


best = sorted(cands, key=score, reverse=True)[0]
print(best[2])
