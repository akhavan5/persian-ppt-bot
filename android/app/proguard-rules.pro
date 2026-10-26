# شماره‌ی خط در گزارش کرش خوانا بماند (mapping.txt را نگه دارید)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# OkHttp: کتابخانه‌های اختیاری TLS که روی اندروید نیستند
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**

# پولکی (پرداخت کافه‌بازار)
-keep class ir.cafebazaar.poolakey.** { *; }
-keep class com.farsitel.bazaar.** { *; }
-dontwarn ir.cafebazaar.poolakey.**

# مایکت (پرداخت درون‌برنامه‌ای)
-keep class ir.myket.billingclient.** { *; }
-keep interface ir.myket.billingclient.** { *; }
-keep class com.android.vending.billing.** { *; }
-keep interface com.android.vending.billing.** { *; }
-dontwarn ir.myket.billingclient.**
