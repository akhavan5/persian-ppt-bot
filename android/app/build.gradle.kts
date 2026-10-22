plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// امضا فقط وقتی ست می‌شود که متغیرهای محیطی (در GitHub Actions) موجود باشند
val ksFile: String? = System.getenv("KEYSTORE_FILE")
val ksPass: String? = System.getenv("KS_PASS")
val hasKeystore = !ksFile.isNullOrEmpty() && !ksPass.isNullOrEmpty()

android {
    namespace = "ir.pptsaz.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "ir.pptsaz.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 3      // نسخه‌ی TWA قبلی ۲ بود؛ باید بزرگ‌تر باشد تا روی آن نصب شود
        versionName = "2.0.0"
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
            isMinifyEnabled = false
            if (hasKeystore) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
