#!/usr/bin/env python3
"""ارسال یک‌باره‌ی پیام خوش‌آمد بله (قالب سفیر) به شماره‌های فعلی.

استفاده:
  export SAFIR_API_KEY='کلید-جدید'          # داخل فایل ننویس
  python3 scripts/send_bale_welcome.py numbers.txt            # اجرای واقعی
  python3 scripts/send_bale_welcome.py numbers.txt --dry-run  # فقط بررسی شماره‌ها، بدون ارسال

numbers.txt یا mobiles.csv: در txt هر خط یک شماره؛ در csv ستون mobile (یا phone_e164، وگرنه ستون اول). فرمت ۰۹۱۲…، ۹۸۹۱۲…، +۹۸… و ارقام فارسی همه قبول است.

خروجی:
  welcome_report.csv  نتیجه‌ی هر شماره
  bw_seed.sql         شماره‌های موفق؛ حتماً بعد از اجرا روی D1 اجرا کن تا همین افراد هنگام ورود، پیام را دوباره نگیرند:
                      npx wrangler d1 execute persian-ppt-bot-db --remote --file=bw_seed.sql
اجرای دوباره‌ی اسکریپت امن است: request_id هر شماره ثابت است و سفیر پیام تکراری نمی‌فرستد.
"""
import csv, hashlib, json, os, re, sys, time, urllib.request, urllib.error

URL = "https://safir.bale.ai/api/v3/send_message"
BOT_ID = int(os.environ.get("SAFIR_BOT_ID", "1186583240"))
TEMPLATE = os.environ.get("SAFIR_WELCOME_TEMPLATE", "413y0Z")
KEY = os.environ.get("SAFIR_API_KEY", "").strip()
DELAY = float(os.environ.get("SEND_DELAY", "0.5"))  # ثانیه بین دو ارسال


def norm(v: str):
    """به شکل 09123456789 (همان قالب KV پروژه)؛ نامعتبر = None"""
    m = v.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"))
    m = re.sub(r"[\s\-()]", "", m)
    m = re.sub(r"^(\+98|0098|98)", "0", m)
    if re.fullmatch(r"9\d{9}", m):
        m = "0" + m
    return m if re.fullmatch(r"09\d{9}", m) else None


def read_values(path: str):
    """txt: هر خط یک شماره. csv: ستون mobile (یا phone_e164، وگرنه ستون اول)"""
    with open(path, encoding="utf-8-sig") as f:
        if not path.lower().endswith(".csv"):
            yield from (l.strip() for l in f if l.strip())
            return
        rows = list(csv.reader(f))
    if not rows:
        return
    head = [h.strip().lower() for h in rows[0]]
    col = next((head.index(n) for n in ("mobile", "phone_e164", "phone") if n in head), None)
    for r in rows[1:] if col is not None else rows:
        v = (r[col if col is not None else 0] if r else "").strip()
        if v:
            yield v


def send(mobile: str):
    """برمی‌گرداند (وضعیت، توضیح): sent | not_bale | rate | no_credit | error"""
    body = {
        # ثابت برای هر شماره/قالب ⇒ اجرای دوباره پیام تکراری نمی‌فرستد
        "request_id": "welcome-" + hashlib.sha256(f"{TEMPLATE}:{mobile}".encode()).hexdigest()[:24],
        "bot_id": BOT_ID,
        "phone_number": "98" + mobile[1:],
        "message_data": {"template_message": {"template_id": TEMPLATE, "text_fields": {}}},
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "api-access-key": KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: j = json.loads(e.read() or b"{}")
        except Exception: j = {}
    except Exception as e:
        return "error", str(e)[:100]
    errs = j.get("error_data") or []
    if j.get("message_id") and not errs:
        return "sent", j["message_id"]
    code = errs[0].get("code") if errs else None
    desc = errs[0].get("description", "") if errs else json.dumps(j)[:100]
    return {17: "not_bale", 3: "rate", 20: "no_credit"}.get(code, "error"), desc


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    if not args:
        sys.exit(__doc__)
    if not KEY and not dry:
        sys.exit("SAFIR_API_KEY تنظیم نشده است.")
    seen, nums, bad = set(), [], []
    for line in read_values(args[0]):
        m = norm(line)
        if m is None: bad.append(line)
        elif m not in seen: seen.add(m); nums.append(m)
    print(f"شماره‌ی معتبر: {len(nums)} | نامعتبر: {len(bad)} {bad[:5] if bad else ''}")
    if dry:
        return

    rows, sent = [], []
    for i, m in enumerate(nums, 1):
        st, info = send(m)
        for attempt in range(3):  # محدودیت نرخ: کمی صبر و دوباره
            if st != "rate": break
            time.sleep(5 * (attempt + 1)); st, info = send(m)
        rows.append((m, st, info))
        if st == "sent": sent.append(m)
        print(f"[{i}/{len(nums)}] {m} {st}")
        if st == "no_credit":
            print("اعتبار سفیر تمام شد؛ بعد از شارژ دوباره اجرا کن (ارسال‌شده‌ها تکرار نمی‌شوند)."); break
        time.sleep(DELAY)

    with open("welcome_report.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["mobile", "status", "info"]); w.writerows(rows)
    with open("bw_seed.sql", "w", encoding="utf-8") as f:
        for m in sent:
            f.write(f"INSERT OR IGNORE INTO kv (k, v, exp) VALUES ('bw:{m}', '1', NULL);\n")
    cnt = lambda s: sum(1 for r in rows if r[1] == s)
    print(f"\nارسال‌شده: {cnt('sent')} | بله ندارد: {cnt('not_bale')} | خطا: {cnt('error')} | اعتبار/نرخ: {cnt('no_credit') + cnt('rate')}")
    print("حالا اجرا کن: npx wrangler d1 execute persian-ppt-bot-db --remote --file=bw_seed.sql")

main()
