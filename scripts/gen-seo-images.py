#!/usr/bin/env python3
"""تولید تصویرهای اختصاصی سئو برای هر صفحه و مقاله (PNG برای og:image + WebP برای صفحه) و تصویرهای صفحه‌ی اصلی.

اجرا (از ریشه‌ی پروژه):
    npx tsx scripts/dump-seo-data.ts /tmp/seo-data.json
    python3 scripts/gen-seo-images.py /tmp/seo-data.json

نیازمندی‌ها: python3، playwright (با chromium) و Pillow. خروجی در public/img/ نوشته می‌شود.
نام فایل‌ها باید با src/seo-images.ts هماهنگ بماند.
"""
import io, json, os, sys, html
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
FONTS = PUB / "fonts"
OUT = PUB / "img"

# همان قالب‌های themes.ts
THEMES = [
    ("ocean", "اقیانوس", "1F4E8C", "14335C", "2E9CCA", "EAF2FB", False),
    ("forest", "جنگل", "2F7D5B", "1D4D38", "E0A93B", "EAF5EE", False),
    ("sunset", "غروب", "D9482B", "8E2A16", "F2A541", "FDEFE7", False),
    ("royal", "سلطنتی", "5B3FA6", "3A2673", "E05CA0", "F0ECF9", False),
    ("violet", "بنفش و نارنجی", "6B3FF5", "3F23A0", "FF9225", "EEE9FF", False),
    ("midnight", "نیمه‌شب", "4F46E5", "0B1120", "22D3EE", "1E293B", True),
]
# تصویرهای وب‌سایت/لندینگ‌ها از ۵ قالب روشن می‌آیند تا هم‌خانواده‌ی برند (آبی) بمانند
PAGE_THEMES = [0, 1, 3, 4, 2, 5]

def theme_for(key: str):
    h = sum((i + 1) * ord(c) for i, c in enumerate(key))
    return THEMES[PAGE_THEMES[h % len(PAGE_THEMES)]]

e = html.escape
FA = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")
fa = lambda n: str(n).translate(FA)

def font_css():
    return f"""
@font-face{{font-family:V;font-weight:400;src:url('file://{FONTS}/Vazirmatn-Regular.ttf')}}
@font-face{{font-family:V;font-weight:700;src:url('file://{FONTS}/Vazirmatn-Bold.ttf')}}
"""

BASE_CSS = font_css() + """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:var(--W);height:var(--H);overflow:hidden}
body{font-family:V,Tahoma,sans-serif;direction:rtl;position:relative;color:var(--ink);background:var(--bg)}
.bgdeco{position:absolute;inset:0;overflow:hidden}
.bgdeco i{position:absolute;border-radius:50%;opacity:.5}
.wrap{position:absolute;inset:0;padding:54px 60px;display:flex;gap:44px}
.txt{flex:1;display:flex;flex-direction:column;justify-content:space-between;min-width:0;position:relative;z-index:2}
.chip{align-self:flex-start;background:var(--chipbg);color:var(--chipfg);font-weight:700;font-size:26px;padding:6px 22px;border-radius:999px}
h1{font-weight:700;line-height:1.5;color:var(--h);letter-spacing:0}
.sub{font-size:25px;color:var(--muted);line-height:1.7}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;font-size:28px;color:var(--h)}
.brand b{display:inline-flex;width:46px;height:46px;border-radius:13px;background:var(--p);color:#fff;align-items:center;justify-content:center;font-size:26px}
.brand span.u{margin-inline-start:auto;font-size:26px;color:var(--p);direction:ltr}
.mock{position:relative;z-index:1;flex:none}
.card{position:absolute;border-radius:22px;background:var(--cardbg);box-shadow:0 18px 50px rgba(15,30,60,.22);overflow:hidden}
.card .bar{height:18%;background:var(--p);display:flex;align-items:center;padding:0 7%}
.card .bar s{display:block;height:34%;width:46%;border-radius:99px;background:rgba(255,255,255,.92)}
.card .bar em{display:block;height:34%;width:12%;margin-inline-start:auto;border-radius:99px;background:var(--a)}
.card .body{padding:7%;display:flex;gap:6%;height:82%}
.lines{flex:1.2;display:flex;flex-direction:column;gap:13%;padding-top:2%}
.lines u{display:block;height:9%;border-radius:99px;background:var(--line);text-decoration:none;position:relative}
.lines u:before{content:"";position:absolute;right:0;top:50%;width:150%;transform:translateY(-50%)}
.lines u:nth-child(1){width:96%}.lines u:nth-child(2){width:80%}.lines u:nth-child(3){width:90%}.lines u:nth-child(4){width:62%}
.chart{flex:1;display:flex;align-items:flex-end;gap:9%;padding-bottom:3%}
.chart i{flex:1;border-radius:8px 8px 0 0;background:var(--p)}
.chart i:nth-child(2){background:var(--a)}.chart i:nth-child(3){background:var(--p);opacity:.55}
"""

def theme_vars(t, W, H):
    _, _, p, dark, a, soft, is_dark = t
    if is_dark:
        v = dict(bg="#0F172A", ink="#F1F5F9", h="#FFFFFF", muted="#A9B6CB", chipbg="#1E293B", chipfg="#" + a, cardbg="#1E293B", line="#334155", deco1="#4F46E5", deco2="#0891B2")
    else:
        v = dict(bg="#F7FAFF", ink="#1B2733", h="#" + dark, muted="#5B6B86", chipbg="#" + soft, chipfg="#" + p, cardbg="#FFFFFF", line="#DCE5F2", deco1="#" + soft, deco2="#" + a + "33")
    v.update(p="#" + p, a="#" + a)
    return ":root{" + ";".join(f"--{k}:{val}" for k, val in v.items()) + f";--W:{W}px;--H:{H}px" + "}"

def mock_html(w, h):
    # سه کارت اسلاید روی هم، مثل خروجی واقعی (فقط نوار رنگی، خطوط و نمودار)
    def card(x, y, cw, ch, rot, extra=""):
        return f"""<div class="card" style="left:{x}px;top:{y}px;width:{cw}px;height:{ch}px;transform:rotate({rot}deg);{extra}">
<div class="bar"><s></s><em></em></div><div class="body"><div class="lines"><u></u><u></u><u></u><u></u></div><div class="chart"><i style="height:45%"></i><i style="height:80%"></i><i style="height:62%"></i></div></div></div>"""
    cw, ch = int(w * .78), int(h * .52)
    return f"""<div class="mock" style="width:{w}px;height:{h}px">
{card(int(w*.02), int(h*.04), cw, ch, -7, "opacity:.55")}
{card(int(w*.14), int(h*.22), cw, ch, 3, "")}
{card(int(w*.05), int(h*.44), cw, ch, -2, "")}
</div>"""

def hero_html(W, H, label, title, sub, t, layout):
    css = BASE_CSS + theme_vars(t, W, H)
    deco = f'<div class="bgdeco"><i style="width:{int(W*.55)}px;height:{int(W*.55)}px;left:-{int(W*.18)}px;top:-{int(W*.25)}px;background:var(--deco1)"></i><i style="width:{int(W*.4)}px;height:{int(W*.4)}px;right:-{int(W*.1)}px;bottom:-{int(W*.2)}px;background:var(--deco2)"></i></div>'
    n = len(title)
    if layout == "wide":
        fs = 56 if n <= 42 else 48 if n <= 62 else 42
        mw, mh = 440, 480
        css += f".wrap{{flex-direction:row}}h1{{font-size:{fs}px}}"
        body = f"""<div class="wrap"><div class="txt"><span class="chip">{e(label)}</span><h1>{e(title)}</h1><p class="sub">{e(sub)}</p>
<div class="brand"><b>📊</b>پاورپوینت‌ساز فارسی<span class="u">pptsaz.ir</span></div></div>{mock_html(mw, mh)}</div>"""
    else:
        fs = (74 if n <= 42 else 64 if n <= 62 else 56) if layout == "sq" else (62 if n <= 42 else 54 if n <= 62 else 48)
        mh = int(H * .5)
        mw = int(mh * 1.1)
        css += f".wrap{{flex-direction:column;gap:20px;padding:{54 if layout=='r43' else 70}px 64px}}h1{{font-size:{fs}px}}.mock{{align-self:center}}.txt{{gap:18px}}"
        body = f"""<div class="wrap"><div class="txt" style="justify-content:flex-start"><span class="chip">{e(label)}</span><h1>{e(title)}</h1><p class="sub">{e(sub)}</p></div>
{mock_html(mw, mh)}<div class="brand"><b>📊</b>پاورپوینت‌ساز فارسی<span class="u">pptsaz.ir</span></div></div>"""
    return f"<!doctype html><meta charset=utf-8><style>{css}</style><body>{deco}{body}</body>"

def steps_html(W, H, title, steps, t):
    css = BASE_CSS + theme_vars(t, W, H)
    shown = steps[:6]
    more = len(steps) - len(shown)
    cards = "".join(f'<li><b>{fa(i+1)}</b><span>{e(s)}</span></li>' for i, s in enumerate(shown))
    if more > 0:
        cards += f'<li class="more"><b>+</b><span>و {fa(more)} مرحله‌ی دیگر در صفحه</span></li>'
    n = len(title)
    cols = "1fr 1fr" if len(shown) + (1 if more > 0 else 0) > 4 else "1fr"
    css += f"""
.wrap{{flex-direction:column;gap:22px;padding:46px 60px}}
.hd{{display:flex;flex-direction:column;gap:8px}}
.hd small{{font-size:24px;color:var(--p);font-weight:700}}
h1{{font-size:{44 if n<=40 else 38}px;line-height:1.5}}
ol{{list-style:none;display:grid;grid-template-columns:{cols};grid-auto-rows:1fr;gap:16px 22px;flex:1}}
li{{display:flex;align-items:center;gap:18px;background:var(--cardbg);border:2px solid var(--line);border-radius:22px;padding:0 22px;font-size:27px;line-height:1.55;font-weight:700;color:var(--h);box-shadow:0 8px 24px rgba(15,30,60,.08)}}
li b{{flex:none;width:54px;height:54px;border-radius:16px;background:var(--p);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px}}
li.more{{background:transparent;border-style:dashed;color:var(--muted);font-weight:400}}li.more b{{background:var(--a)}}
"""
    deco = '<div class="bgdeco"><i style="width:520px;height:520px;left:-180px;top:-240px;background:var(--deco1)"></i></div>'
    body = f"""<div class="wrap"><div class="hd"><small>مراحل کار</small><h1>{e(title)}</h1></div><ol>{cards}</ol>
<div class="brand"><b>📊</b>پاورپوینت‌ساز فارسی<span class="u">pptsaz.ir</span></div></div>"""
    return f"<!doctype html><meta charset=utf-8><style>{css}</style><body>{deco}{body}</body>"

def slide_html(W, H, t, title, bullets):
    """نمونه‌ی ظاهر قالب (۱۶:۹) برای گالری صفحه‌ی اصلی."""
    css = BASE_CSS + theme_vars(t, W, H)
    li = "".join(f"<li>{e(b)}</li>" for b in bullets)
    css += f"""
body{{background:var(--cardbg)}}
.top{{height:21%;background:var(--p);display:flex;align-items:center;padding:0 6%;gap:20px}}
.top h1{{color:#fff;font-size:44px;flex:1}}.top em{{width:64px;height:12px;border-radius:99px;background:var(--a)}}
.main{{display:flex;gap:5%;padding:5% 6%;height:79%}}
ul{{flex:1.2;list-style:none;display:flex;flex-direction:column;justify-content:center;gap:22px}}
li{{font-size:32px;color:var(--ink);padding-right:34px;position:relative;line-height:1.6}}
li:before{{content:"";position:absolute;right:0;top:19px;width:16px;height:16px;border-radius:50%;background:var(--a)}}
.chart{{flex:1;padding:0 4%;align-items:flex-end;gap:7%;border-bottom:3px solid var(--line)}}.chart i{{border-radius:10px 10px 0 0}}
.ft{{position:absolute;left:30px;bottom:18px;font-size:20px;color:var(--muted);direction:ltr}}
"""
    return f"""<!doctype html><meta charset=utf-8><style>{css}</style><body><div class="top"><h1>{e(title)}</h1><em></em></div>
<div class="main"><ul>{li}</ul><div class="chart"><i style="height:38%"></i><i style="height:78%"></i><i style="height:55%"></i><i style="height:92%"></i></div></div><div class="ft">pptsaz.ir</div></body>"""

def save(img: Image.Image, base: Path, png=False, webp=True, widths=()):
    base.parent.mkdir(parents=True, exist_ok=True)
    img = img.convert("RGB")
    if png:
        img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(base.with_suffix(".png"), optimize=True)
    if webp:
        img.save(base.with_suffix(".webp"), "WEBP", quality=84, method=6)
    for w in widths:
        h = round(img.height * w / img.width)
        img.resize((w, h), Image.LANCZOS).save(base.parent / f"{base.name}-{w}.webp", "WEBP", quality=82, method=6)

def main():
    data = json.load(open(sys.argv[1]))
    jobs = []  # (relative base, html, W, H, png, webp, widths)
    for p in data["pages"]:
        t = theme_for(p["slug"])
        label = p["audience"] and f"برای {p['audience']}" or "راهنمای ساخت پاورپوینت"
        sub = "با هوش مصنوعی · فارسی و راست‌به‌چپ · کاملاً قابل‌ویرایش"
        jobs.append((f"landing/{p['slug']}", hero_html(1200, 630, label, p["h1"], sub, t, "wide"), 1200, 630, True, True, (640,)))
        if len(p["steps"]) >= 3:
            jobs.append((f"steps/{p['slug']}", steps_html(1200, 630, p["stepsH2"] or p["h1"], p["steps"], t), 1200, 630, False, True, ()))
    for p in data["posts"]:
        t = theme_for(p["slug"])
        sub = "مقاله‌ی راهنما در وبلاگ پاورپوینت‌ساز فارسی"
        jobs.append((f"blog/{p['slug']}", hero_html(1200, 630, p["category"], p["h1"], sub, t, "wide"), 1200, 630, True, True, (640,)))
        jobs.append((f"blog/{p['slug']}-1x1", hero_html(1080, 1080, p["category"], p["h1"], sub, t, "sq"), 1080, 1080, False, True, ()))
        jobs.append((f"blog/{p['slug']}-4x3", hero_html(1200, 900, p["category"], p["h1"], sub, t, "r43"), 1200, 900, False, True, ()))
        if len(p["steps"]) >= 3:
            jobs.append((f"blog-steps/{p['slug']}", steps_html(1200, 630, p["stepsH2"] or p["h1"], p["steps"], t), 1200, 630, False, True, ()))
    # صفحه‌ی اصلی: نمونه‌ی ۶ قالب
    for i, t in enumerate(THEMES):
        jobs.append((f"home/template-{t[0]}", slide_html(960, 540, t, "هوش مصنوعی در آموزش", ["یادگیری شخصی‌سازی‌شده برای هر دانش‌آموز", "تصحیح خودکار و بازخورد فوری", "صرفه‌جویی در زمان معلم"]), 960, 540, False, True, ()))
    only = os.environ.get("ONLY")
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        n = 0
        for rel, doc, W, H, png, webp, widths in jobs:
            if only and only not in rel:
                continue
            tmp = OUT / "_tmp.html"
            OUT.mkdir(parents=True, exist_ok=True)
            tmp.write_text(doc, encoding="utf-8")
            pg = br.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
            pg.goto(f"file://{tmp}")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(60)
            img = Image.open(io.BytesIO(pg.screenshot()))
            pg.close()
            save(img, OUT / rel, png=png, webp=webp, widths=widths)
            n += 1
        br.close()
    (OUT / "_tmp.html").unlink(missing_ok=True)
    print("generated", n, "images")

if __name__ == "__main__":
    main()
