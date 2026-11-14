package ir.pptsaz.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * تبلیغ همسان به شکل یک کارت لابه‌لای فهرست فایل‌ها.
 * - تپسل (در صورت روشن‌بودن): دو جایگاه جدا دارد؛ بنر همسان و ویدئو همسان.
 * - ادیوری: یک جایگاه همسان دارد؛ فقط در جایگاه «بنر همسان» نمایش داده می‌شود تا دو کارت پشت‌سرهم نیاید.
 * صفحه‌ها همچنان با [bannerZone] / [videoZone] کار می‌کنند؛ مقدار خالی یعنی آن جایگاه خاموش است.
 */
object AdsNative {
    private const val ADIVERY = "adivery"

    val bannerZone: String get() = when {
        TapsellAds.nativeOn(TapsellAds.nativeBannerZone) -> TapsellAds.nativeBannerZone
        AdiveryAds.nativeOn -> ADIVERY
        else -> ""
    }
    val videoZone: String get() = if (TapsellAds.nativeOn(TapsellAds.nativeVideoZone)) TapsellAds.nativeVideoZone else ""

    fun on(zone: String) = BuildConfig.ADS_ENABLED && zone.isNotEmpty()

    @Composable
    fun Card(zone: String, paid: Boolean, modifier: Modifier = Modifier) {
        if (!on(zone) || paid || Ads.adFree()) return
        if (zone == ADIVERY) AdiveryAds.NativeCard(modifier) else TapsellAds.NativeCard(zone, modifier)
    }
}
