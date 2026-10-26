pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google(); mavenCentral()
        // فقط کتابخانه‌های پرداخت فروشگاه‌ها از JitPack گرفته می‌شوند (قطعی یا تغییر بقیه‌ی بسته‌های آن روی بیلد اثر نگذارد)
        maven {
            url = uri("https://jitpack.io")
            content {
                includeGroup("com.github.cafebazaar.Poolakey")
                includeGroup("com.github.myketstore")
            }
        }
    }
}
rootProject.name = "pptsaz"
include(":app")
