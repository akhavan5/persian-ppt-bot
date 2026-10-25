# شماره‌ی خط در گزارش کرش خوانا بماند (mapping.txt را نگه دارید)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# OkHttp: کتابخانه‌های اختیاری TLS که روی اندروید نیستند
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-dontwarn javax.annotation.**
