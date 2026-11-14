pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google(); mavenCentral()
        // کتابخانه‌ی تبلیغات تپسل (فقط گروه‌های خودش)
        maven {
            url = uri("https://maven.tapsell.ir")
            content { includeGroupByRegex("ir\\.tapsell.*") }
        }
        // فقط کتابخانه‌های پرداخت فروشگاه‌ها از JitPack گرفته می‌شوند (قطعی یا تغییر بقیه‌ی بسته‌های آن روی بیلد اثر نگذارد)
        maven {
            url = uri("https://jitpack.io")
            content {
                includeGroup("com.github.cafebazaar.Poolakey")
                includeGroup("com.github.cafebazaar") // BazaarUpdater
                includeGroup("com.github.myketstore")
            }
        }
    }
}
rootProject.name = "pptsaz"
include(":app")
