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
        // کلید عمومی RSA پرداخت درون‌برنامه‌ای کافه‌بازار (کلید عمومی است؛ محرمانه نیست)
        buildConfigField("String", "BAZAAR_RSA_KEY", "\"MIHNMA0GCSqGSIb3DQEBAQUAA4G7ADCBtwKBrwDXfSTtYYKzEZfiN3uOiRiZL6B6VeaYy3sKYGufqwD5pu4sYNmCSfth7VE1dedYe/ylS5+lvjiQkwZog7HRNuPuG2gntNnYT5WbuMqJScB7u9cEj1vpmk3ENuuGp5ngCtk45jtAdSZ408ZDYZqpWjCJZ65lMCZsf8SBVV6YISYlLb0fM85fL9GQhbLLIHb8JeCPbHhoqAqsWcXvzcJR97qHopblekWaMRtdRayinYECAwEAAQ==\"")
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
    implementation("androidx.browser:browser:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // پرداخت درون‌برنامه‌ای کافه‌بازار (پولکی)
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")
    // بررسی پس‌زمینه‌ی پایان ساخت ارائه (اعلان محلی)
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
