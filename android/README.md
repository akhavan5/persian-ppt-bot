# اپ اندروید پاورپوینت‌ساز (بومی)

اپ کاملاً بومی (Kotlin + Jetpack Compose) که مستقیم با API سایت (`https://pptsaz.ir/api/...`) حرف می‌زند؛ ورود، ساخت، فایل‌ها و خرید کاملاً بومی‌اند و به Chrome وابسته نیست (فقط صفحه‌ی پیش‌نمایش اسلایدها در یک WebView کوچک باز می‌شود).

## امکانات (هم‌تراز با وب)
- ورود فقط با شماره‌ی موبایل و کد پیامکی (نشست ماندگار)
- **ساخت:** موضوع، تعداد اسلاید، تعداد تصویر، متن منبع (تایپی، از PDF/عکس یا از لینک)، جزوه‌ی Word، پوستر افقی/عمودی، پیگیری پیشرفت (حتی بعد از بستن اپ)
- **پیش‌نمایش اسلایدها** و ذخیره‌ی PDF (صفحه‌ی پیش‌نمایش را سرور می‌سازد و داخل یک WebView کوچک نشان داده می‌شود)
- **فایل‌های ۲۴ ساعت اخیر:** دانلود PPTX/Word/پوستر، نمایش پوستر
- **تنظیمات:** قالب (با توضیح)، تم رنگی، لحن، فونت، حالت ساخت (عادی/دانشجویی/کسب‌وکار/معلم/دفاع پایان‌نامه)، ارقام فارسی، اسلاید منابع، اسلاید پرسش‌های پایانی، مدل هوش مصنوعی
- **حساب:** ویرایش نام، اعتبار (پلن/هدیه)، اعتبار رایگان روزانه، پلن فعال و تاریخ پایان، خرید اشتراک (درگاه یا لینک ربات تلگرام)، پشتیبانی، خروج

## عمداً در اپ نیست
ورود با گوگل و تلگرام (ورود اپ فقط با موبایل است)، و صفحه‌های معرفی/راهنمای سایت.

## مشخصات
- پکیج `ir.pptsaz.app` (همان قبلی؛ با همان keystore امضا می‌شود)، `minSdk 24`، `targetSdk 36` (مطابق `app/build.gradle.kts`)

## بیلد
Actions → «Build Android app (native)» → Run workflow (اسم workflow همان مانده؛ می‌توانید عوض کنید).
Secrets: `ANDROID_KEYSTORE_B64` و `ANDROID_KEYSTORE_PASSWORD` (alias کلید: `pptsaz`).
خروجی: artifact با نام `pptsaz-android` (فایل‌های `pptsaz.apk` و `pptsaz.aab`).

## تست
تست‌های واحد منطق خالص (شماره‌ی موبایل، کد پیامکی، خواندن txt/docx) در `app/src/test` هستند و در workflow بالا قبل از بیلد اجرا می‌شوند.
محلی: `gradle -p android testBazaarDebugUnitTest`


## تبلیغات (هر فروشگاه یک شبکه)

شبکه‌ی تبلیغاتی هر فروشگاه با **Variable** مخزن گیت‌هاب تعیین می‌شود (GitHub → Settings → Secrets and variables → Actions → تب **Variables**):

| متغیر | پیش‌فرض (اگر خالی باشد) | مقدارهای مجاز |
|---|---|---|
| `BAZAAR_ADS` | `tapsell` | `tapsell` · `adivery` · `none` |
| `MYKET_ADS` | `adivery` | `tapsell` · `adivery` · `none` |

برای عوض‌کردن: مقدار متغیر را عوض کنید و workflow را دوباره Run کنید. `none` تبلیغ آن فروشگاه را کاملاً خاموش می‌کند. مقدار نامعتبر بیلد را با پیام خطای واضح متوقف می‌کند.

**Secrets لازم** (بدون APP_ID/APP_KEY در release تبلیغ آن شبکه خاموش می‌ماند؛ هر جایگاهِ خالی هم فقط همان نوع تبلیغ را خاموش می‌کند):
- تپسل: `TAPSELL_APP_KEY`، `TAPSELL_BANNER_ZONE`، `TAPSELL_INTERSTITIAL_ZONE`، `TAPSELL_INTERSTITIAL_BANNER_ZONE`، `TAPSELL_NATIVE_BANNER_ZONE`، `TAPSELL_NATIVE_VIDEO_ZONE`، `TAPSELL_REWARDED_ZONE`
- ادیوری: `ADIVERY_APP_ID`، `ADIVERY_BANNER_PLACEMENT`، `ADIVERY_INTERSTITIAL_PLACEMENT`، `ADIVERY_NATIVE_PLACEMENT`، `ADIVERY_REWARDED_PLACEMENT`

نسخه‌ی SDK تپسل: متغیر اختیاری `TAPSELL_VERSION` (خالی = `1.3.0`).

در بیلد debug هر شبکه‌ای با شناسه‌های تست خودش کار می‌کند.

ساختار کد: `Ads.kt` / `AdsNative.kt` نقطه‌ی ورود مشترک؛ `AdiveryAds.kt` ادیوری؛ `src/tapsell/…/TapsellAds.kt` تپسل واقعی؛ `src/tapsellOff/…/TapsellAds.kt` نسخه‌ی خالی هم‌API (برای فروشگاهی که تپسل ندارد؛ SDK تپسل آنجا وارد APK نمی‌شود). انتخاب در `app/build.gradle.kts` (بخش `storeAds` و `androidComponents`) انجام می‌شود.
