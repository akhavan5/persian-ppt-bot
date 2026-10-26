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

android {
    namespace = "ir.pptsaz.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ir.pptsaz.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 2
        versionName = "1.1.0"
    }

    // دو نسخه از یک کد: «bazaar» با پرداخت پولکی و مجوز بازار، «myket» کاملاً بدون مجوز و کتابخانه‌ی بازار
    flavorDimensions += "store"
    productFlavors {
        create("bazaar") {
            dimension = "store"
            // کلید عمومی RSA پرداخت درون‌برنامه‌ای کافه‌بازار (کلید عمومی است؛ محرمانه نیست)
            buildConfigField("String", "BAZAAR_RSA_KEY", "\"MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwDXfSTtYYKzEZfiN3uOiRiZL6B6VeaYy3sKYGufqwD5pu4sYNmCSfth7VE1dedYe/ylS5+lvjiQkwZog7HRNuPuG2gntNnYT5WbuMqJScB7u9cEj1vpmk3ENuuGp5ngCtk45jtAdSZ408ZDYZqpWjCJZ65lMCZsf8SBVV6YISYlLb0fM85fL9GQhbLLIHb8JeCPbHhoqAqsWcXvzcJR97qHopblekWaMRtdRayinYECAwEAAQ==\"")
        }
        create("myket") {
            dimension = "store"
            // کتابخانه‌ی پرداخت مایکت مجوز و queries خودش را با این placeholderها به manifest اضافه می‌کند (ir.mservices.market.BILLING)
            manifestPlaceholders["marketApplicationId"] = "ir.mservices.market"
            manifestPlaceholders["marketBindAddress"] = "ir.mservices.market.InAppBillingService.BIND"
            manifestPlaceholders["marketPermission"] = "ir.mservices.market.BILLING"
            // کلید عمومی RSA پرداخت درون‌برنامه‌ای مایکت (کلید عمومی است؛ محرمانه نیست)
            buildConfigField("String", "IAB_PUBLIC_KEY", "\"MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQD39JomlD/MfP2+OYY9DCw6fRp5mnBKBHYuWYrAvg3wml2Njceh0LivP3iTo0w7b3UfSgQBi9Of7op9y0lr3Px6AkORg07mk71tbmsZqY/IKO60zGI273bxEJOnRDH2aL4Ce+TW4A7IFE2h3bh/MtmZKRF1p9JFdhR3r96PckFcNwIDAQAB\"")
        }
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
    implementation("androidx.browser:browser:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی)
    "bazaarImplementation"("com.github.cafebazaar.Poolakey:poolakey:2.2.0")
    // پرداخت درون‌برنامه‌ای مایکت (فقط نسخه‌ی مایکت)
    "myketImplementation"("com.github.myketstore:myket-billing-client:1.6")
    // بررسی پس‌زمینه‌ی پایان ساخت ارائه (اعلان محلی)
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
