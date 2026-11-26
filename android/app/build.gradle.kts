import com.android.build.api.variant.BuildConfigField
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// امضا فقط وقتی ست می‌شود که متغیرهای محیطی (در GitHub Actions) موجود باشند
val ksFile: String? = System.getenv("KEYSTORE_FILE")
val ksPass: String? = System.getenv("KS_PASS")
val hasKeystore = !ksFile.isNullOrEmpty() && !ksPass.isNullOrEmpty()

// ---------------------------------------------------------------- شبکه‌ی تبلیغاتی هر فروشگاه
// هر فروشگاه دقیقاً یک شبکه‌ی تبلیغاتی دارد که با «متغیر» (Variables) مخزن گیت‌هاب تعیین می‌شود:
//   BAZAAR_ADS = tapsell | adivery | none   (خالی = tapsell)
//   MYKET_ADS  = tapsell | adivery | none   (خالی = adivery)
val adNetworks = listOf("tapsell", "adivery", "none")
fun adNetworkOf(envName: String, default: String): String {
    val v = (System.getenv(envName) ?: "").trim().lowercase()
    if (v.isEmpty()) return default
    require(v in adNetworks) { "$envName=\"$v\" نامعتبر است؛ فقط یکی از: ${adNetworks.joinToString(" | ")}" }
    return v
}
val storeAds = mapOf(
    "bazaar" to adNetworkOf("BAZAAR_ADS", "tapsell"),
    "myket" to adNetworkOf("MYKET_ADS", "adivery"),
)
logger.lifecycle("Ads → " + storeAds.entries.joinToString(", ") { "${it.key}=${it.value}" })

// ---------------------------------------------------------------- تپسل
// کلید برنامه و شناسه‌ی جایگاه‌ها از متغیر محیطی (GitHub Secrets) می‌آید.
// بدون آن‌ها: بیلد debug با کلیدهای تست تپسل کار می‌کند و در بیلد release تبلیغ کاملاً خاموش می‌ماند (تبلیغ تستی منتشر نشود).
// نسخه‌ی SDK: پیش‌فرض 1.4.0-alpha04 (آخرین نسخه‌ی 1.4؛ از secret-key و کلید قدیمی ۲۴ کاراکتری پشتیبانی می‌کند)؛ با متغیر گیت‌هاب TAPSELL_VERSION عوض می‌شود (مثلاً 1.3.0 برای آخرین پایدار)
val tapsellVersion = (System.getenv("TAPSELL_VERSION") ?: "").trim().ifEmpty { "1.4.0-alpha04" }
val tapsellKeyEnv = (System.getenv("TAPSELL_APP_KEY") ?: "").trim()
val tapsellReal = tapsellKeyEnv.isNotEmpty()
val tapsellTestKey = "76798342-99a7-4a5f-bf5a-60a088d5dcfb"
// هر جایگاهِ خالی همان نوع تبلیغ را خاموش می‌کند. در debug اگر متغیر نبود جایگاه تست تپسل (همه‌ی شبکه‌ها) استفاده می‌شود.
val tapsellZones = listOf(
    Triple("TAPSELL_INTERSTITIAL_ZONE", "b3972749-f62a-475a-9ff2-cfc9e2a40f87", "آنی ویدئو"),
    Triple("TAPSELL_INTERSTITIAL_BANNER_ZONE", "b3972749-f62a-475a-9ff2-cfc9e2a40f87", "بنر آنی"),
    Triple("TAPSELL_BANNER_ZONE", "e3d5999c-5990-4e31-8ce9-642ce040a7f4", "بنر استاندارد"),
    Triple("TAPSELL_NATIVE_BANNER_ZONE", "d217e3e6-0070-4120-925d-5d39d0298893", "بنر همسان"),
    Triple("TAPSELL_NATIVE_VIDEO_ZONE", "d217e3e6-0070-4120-925d-5d39d0298893", "ویدئو همسان"),
    Triple("TAPSELL_REWARDED_ZONE", "1d710cc7-5e96-46ac-a3e9-8463300333e6", "ویدئو جایزه‌ای"),
)

// ---------------------------------------------------------------- ادیوری
// شناسه‌ها از متغیر محیطی (GitHub Secrets) با پیشوند ADIVERY_ می‌آیند. بدون ADIVERY_APP_ID: debug با شناسه‌های تست رسمی ادیوری
// (docs.adivery.com/testing) کار می‌کند و در release تبلیغ کاملاً خاموش است. هر جایگاهِ خالی هم همان نوع تبلیغ را خاموش می‌کند.
val adiveryVersion = "4.10.0"
val adiveryTestApp = "59c36ce3-7125-40a7-bd34-144e6906c796"
val adiveryPlacements = listOf(
    Pair("INTERSTITIAL_PLACEMENT", "38b301f2-5e0c-4776-b671-c6b04a612311"), // آنی
    Pair("REWARDED_PLACEMENT", "16414bae-368e-4904-b259-c5b89362206d"),     // ویدئو جایزه‌ای
    Pair("BANNER_PLACEMENT", "a355be22-970a-46b8-bc52-f0a59c4ded05"),       // بنر استاندارد
    Pair("NATIVE_PLACEMENT", "ff454979-efaa-4ab8-b084-7db19e995d9b"),       // همسان
)
fun env(name: String) = (System.getenv(name) ?: "").trim().replace("\"", "")

android {
    namespace = "ir.pptsaz.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ir.pptsaz.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 11
        versionName = "1.1.0"
        manifestPlaceholders["TapsellMediationAppKey"] = if (tapsellReal) tapsellKeyEnv else tapsellTestKey
        // اعلان FCM: از متغیرهای محیطی (GitHub Secrets) می‌آید؛ خالی = اعلان خاموش. فایل google-services.json لازم نیست.
        // آنالیتیکس (GA4/Firebase): SDK شناسه‌ی اپ را از منبع google_app_id می‌خواند؛ چون پلاگین google-services نداریم، از همان FIREBASE_APP_ID می‌سازیم
        val fbAppId = (System.getenv("FIREBASE_APP_ID") ?: "").trim().replace("\"", "")
        if (fbAppId.isNotEmpty()) resValue("string", "google_app_id", fbAppId)
        for (k in listOf("FIREBASE_APP_ID", "FIREBASE_API_KEY", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID")) {
            buildConfigField("String", k, "\"" + (System.getenv(k) ?: "").trim().replace("\"", "") + "\"")
        }
    }

    // دو نسخه از یک کد: «bazaar» با پرداخت پولکی و مجوز بازار، «myket» کاملاً بدون مجوز و کتابخانه‌ی بازار
    flavorDimensions += "store"
    productFlavors {
        create("bazaar") {
            dimension = "store"
            // نام فروشگاه در User-Agent اپ (PptSazApp/<نسخه> (bazaar; Android <نسخه>)) برای آمار جدای پنل مدیر
            buildConfigField("String", "STORE", "\"bazaar\"")
            // کلید عمومی RSA پرداخت درون‌برنامه‌ای کافه‌بازار (کلید عمومی است؛ محرمانه نیست)
            buildConfigField("String", "BAZAAR_RSA_KEY", "\"MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwDXfSTtYYKzEZfiN3uOiRiZL6B6VeaYy3sKYGufqwD5pu4sYNmCSfth7VE1dedYe/ylS5+lvjiQkwZog7HRNuPuG2gntNnYT5WbuMqJScB7u9cEj1vpmk3ENuuGp5ngCtk45jtAdSZ408ZDYZqpWjCJZ65lMCZsf8SBVV6YISYlLb0fM85fL9GQhbLLIHb8JeCPbHhoqAqsWcXvzcJR97qHopblekWaMRtdRayinYECAwEAAQ==\"")
        }
        create("myket") {
            dimension = "store"
            buildConfigField("String", "STORE", "\"myket\"")
            // کتابخانه‌ی پرداخت مایکت مجوز و queries خودش را با این placeholderها به manifest اضافه می‌کند (ir.mservices.market.BILLING)
            manifestPlaceholders["marketApplicationId"] = "ir.mservices.market"
            manifestPlaceholders["marketBindAddress"] = "ir.mservices.market.InAppBillingService.BIND"
            manifestPlaceholders["marketPermission"] = "ir.mservices.market.BILLING"
            // کلید عمومی RSA پرداخت درون‌برنامه‌ای مایکت (کلید عمومی است؛ محرمانه نیست)
            buildConfigField("String", "IAB_PUBLIC_KEY", "\"MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD39JomlD/MfP2+OYY9DCw6fRp5mnBKBHYuWYrAvg3wml2Njceh0LivP3iTo0w7b3UfSgQBi9Of7op9y0lr3Px6AkORg07mk71tbmsZqY/IKO60zGI273bxEJOnRDH2aL4Ce+TW4A7IFE2h3bh/MtmZKRF1p9JFdhR3r96PckFcNwIDAQAB\"")
        }
    }

    // برای هر فروشگاه فقط یکی از این دو پوشه کامپایل می‌شود: پیاده‌ی واقعی تپسل (اگر شبکه‌ی آن فروشگاه tapsell است) یا نسخه‌ی خالی هم‌API
    for ((store, net) in storeAds) {
        sourceSets.getByName(store).java.srcDir(if (net == "tapsell") "src/tapsell/java" else "src/tapsellOff/java")
    }

    signingConfigs {
        if (hasKeystore) {
            create("release") {
                storeFile = file(ksFile!!)
                storePassword = ksPass
                keyAlias = "pptsaz"
                keyPassword = ksPass
            }
        }
    }

    buildTypes {
        debug {
            // فیلدهای تبلیغات برای هر نسخه در androidComponents.onVariants (پایین‌تر) ساخته می‌شوند
        }
        release {
            // R8: کوچک‌سازی و مبهم‌سازی کد + حذف منابع بلااستفاده (حجم کمتر)
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (hasKeystore) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }

    // تست‌های واحد روی JVM اجرا می‌شوند؛ کلاس‌های android.* پیاده‌سازی ندارند و به‌جای خطا مقدار پیش‌فرض برمی‌گردانند
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

// فیلدهای BuildConfig تبلیغات برای هر نسخه (فروشگاه × debug/release) جدا ساخته می‌شوند تا هر فروشگاه شبکه‌ی خودش را داشته باشد
androidComponents {
    onVariants { variant ->
        val store = variant.flavorName ?: return@onVariants
        val net = storeAds[store] ?: "none"
        val debug = variant.buildType == "debug"
        val fields = variant.buildConfigFields ?: return@onVariants
        fun str(k: String, v: String) { fields.put(k, BuildConfigField("String", "\"" + v.replace("\"", "") + "\"", null)) }
        fun bool(k: String, v: Boolean) { fields.put(k, BuildConfigField("boolean", v.toString(), null)) }

        // تپسل: در release فقط با TAPSELL_APP_KEY روشن است؛ در debug با کلیدهای تست
        val tapsellOn = net == "tapsell" && (debug || tapsellReal)
        // ادیوری: در release فقط با ADIVERY_APP_ID روشن است؛ در debug با شناسه‌های تست
        val adApp = if (net == "adivery") env("ADIVERY_APP_ID") else ""
        val adiveryOn = net == "adivery" && (debug || adApp.isNotEmpty())

        bool("ADS_ENABLED", tapsellOn || adiveryOn)
        str("ADS_NETWORK", net)

        bool("TAPSELL_ENABLED", tapsellOn)
        // فقط برای عیب‌یابی: نسخه‌ی SDK و شکل کلید برنامه (طول و UUID‌بودن؛ خود کلید هرگز در اپ نمی‌آید)
        val usedKey = if (tapsellReal) tapsellKeyEnv else tapsellTestKey
        str("TAPSELL_SDK", tapsellVersion)
        str("TAPSELL_KEY_INFO", "len${usedKey.length}" + if (usedKey.count { it == '-' } == 4) "-uuid" else "-notuuid")
        for ((k, test, _) in tapsellZones) {
            str(k, if (net != "tapsell") "" else env(k).ifEmpty { if (debug) test else "" })
        }

        bool("ADIVERY_ENABLED", adiveryOn)
        str("ADIVERY_APP_ID", if (!adiveryOn) "" else adApp.ifEmpty { if (debug) adiveryTestApp else "" })
        for ((k, test) in adiveryPlacements) {
            str("ADIVERY_$k", if (!adiveryOn) "" else env("ADIVERY_$k").ifEmpty { if (debug) test else "" })
        }

        if (net != "none" && !debug && !tapsellOn && !adiveryOn) {
            logger.warn("⚠ ads: $store=$net ولی شناسه‌ی release ست نشده؛ تبلیغ این نسخه خاموش است (${if (net == "tapsell") "TAPSELL_APP_KEY" else "ADIVERY_APP_ID"})")
        }
    }
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.12.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.12.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.core:core-ktx:1.17.0")
    // play-services (پیامک) Fragment قدیمی ۱.۰ را می‌آورد و lint برای registerForActivityResult خطای fatal می‌دهد؛ نسخه‌ی جدید را صریح مشخص می‌کنیم
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    // اسپلش واحد: جلوگیری از پرش بین اسپلش سیستم و صفحه‌ی بارگذاری Compose
    implementation("androidx.core:core-splashscreen:1.0.1")
    // جهت (EXIF) عکس‌ها در اندروید ۷ و ۸
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    // خواندن خودکار کد پیامکی (نیازمند Google Play Services؛ اگر نبود اپ بدون آن کار می‌کند)
    implementation("com.google.android.gms:play-services-auth-api-phone:18.2.0")
    // ورود با گوگل داخل خود اپ (بدون مرورگر): Credential Manager + Sign in with Google
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    // اعلان تبلیغاتی (FCM)؛ بدون Google Play Services بی‌اثر است و اپ مثل قبل کار می‌کند
    implementation("com.google.firebase:firebase-messaging:24.1.2")
    // آمار استفاده‌ی اپ (Google Analytics 4)؛ بدون FIREBASE_* خاموش است. نسخه‌ی هم‌خانواده با firebase-messaging 24.1.2
    implementation("com.google.firebase:firebase-analytics:22.1.2")
    implementation("androidx.browser:browser:1.9.0")
    // ویجت صفحه‌ی اصلی (Jetpack Glance)
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // تبلیغات ادیوری: بنر، آنی، جایزه‌ای، همسان
    implementation("com.adivery:sdk:$adiveryVersion")
    // شناسه‌ی تبلیغاتی گوگل (GAID) برای هدف‌گیری بهتر؛ ادیوری فقط در صورت وجود این کتابخانه آن را می‌خواند
    implementation("com.google.android.gms:play-services-ads-identifier:18.0.1")
    // تبلیغات تپسل (Mediation) — فقط در فروشگاه‌هایی وارد اپ می‌شود که شبکه‌شان tapsell است (BAZAAR_ADS / MYKET_ADS)
    for ((store, net) in storeAds) {
        if (net == "tapsell") {
            "${store}Implementation"("ir.tapsell:tapsell:$tapsellVersion")
            "${store}Implementation"("ir.tapsell.mediation.adapter:legacy:$tapsellVersion")
        }
    }
    // پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی)
    "bazaarImplementation"("com.github.cafebazaar.Poolakey:poolakey:2.2.0")
    // به‌روزرسانی درون‌برنامه‌ای بازار (فقط نسخه‌ی بازار)
    "bazaarImplementation"("com.github.cafebazaar:bazaarUpdater:1.1.2")
    // پرداخت درون‌برنامه‌ای مایکت (فقط نسخه‌ی مایکت)
    "myketImplementation"("com.github.myketstore:myket-billing-client:1.6")
    // بررسی پس‌زمینه‌ی پایان ساخت ارائه (اعلان محلی)
    // ۲٫۱۰ به بعد timeout سرویس پیش‌زمینه‌ی dataSync اندروید ۱۵ (onTimeout) را مدیریت می‌کند؛ نسخه‌ی ۲٫۹ در این حالت کرش می‌داد
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    testImplementation("junit:junit:4.13.2")
}
