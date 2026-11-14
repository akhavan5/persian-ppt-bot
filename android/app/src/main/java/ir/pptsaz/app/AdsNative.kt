package ir.pptsaz.app

import android.app.Activity
import android.graphics.Color as AColor
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import ir.tapsell.mediation.Tapsell
import ir.tapsell.mediation.ad.AdStateListener
import ir.tapsell.mediation.ad.request.RequestResultListener
import ir.tapsell.mediation.ad.views.ntv.NativeAdView
import ir.tapsell.mediation.ad.views.ntv.NativeAdViewContainer

/** تبلیغ همسان (بنر/ویدئو) به شکل یک کارت لابه‌لای فهرست فایل‌ها؛ ظاهر از رنگ‌های تم اپ ساخته می‌شود. */
object AdsNative {
    val bannerZone get() = BuildConfig.TAPSELL_NATIVE_BANNER_ZONE
    val videoZone get() = BuildConfig.TAPSELL_NATIVE_VIDEO_ZONE

    fun on(zone: String) = BuildConfig.ADS_ENABLED && zone.isNotEmpty()

    /** [zone] = جایگاه همسان؛ بنر همسان و ویدئو همسان در داشبورد تپسل دو جایگاه جدا هستند. */
    @Composable
    fun Card(zone: String, paid: Boolean, modifier: Modifier = Modifier) {
        if (!on(zone) || paid || Ads.adFree()) return
        val activity = LocalContext.current as? Activity ?: return
        val cs = MaterialTheme.colorScheme
        val surface = cs.surfaceVariant.toArgb()
        val onSurface = cs.onSurface.toArgb()
        val onVariant = cs.onSurfaceVariant.toArgb()
        val primary = cs.primary.toArgb()
        val onPrimary = cs.onPrimary.toArgb()
        var adId by remember { mutableStateOf<String?>(null) }
        var loaded by remember { mutableStateOf(false) }
        DisposableEffect(Unit) { onDispose { try { adId?.let { Tapsell.destroyNativeAd(it) } } catch (_: Throwable) {} } }
        AndroidView(
            modifier = modifier.fillMaxWidth(),
            factory = { c ->
                val d = c.resources.displayMetrics.density
                fun dp(v: Int) = (v * d).toInt()
                val container = NativeAdViewContainer(c)
                container.visibility = View.GONE // تا تبلیغ نیامده جایی اشغال نمی‌کند
                container.background = GradientDrawable().apply { setColor(surface); cornerRadius = 16 * d }
                val col = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(12), dp(14), dp(12)) }
                val head = LinearLayout(c).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                val logo = ImageView(c).apply { layoutParams = LinearLayout.LayoutParams(dp(36), dp(36)).apply { marginEnd = dp(10) } }
                val titles = LinearLayout(c).apply { orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) }
                val title = TextView(c).apply { setTextColor(onSurface); textSize = 15f; maxLines = 1 }
                val sponsored = TextView(c).apply { setTextColor(onVariant); textSize = 11f; maxLines = 1 }
                titles.addView(title); titles.addView(sponsored)
                head.addView(logo); head.addView(titles)
                val desc = TextView(c).apply { setTextColor(onVariant); textSize = 13f; maxLines = 3; setPadding(0, dp(8), 0, dp(8)) }
                val media = FrameLayout(c).apply { layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT) }
                val cta = Button(c).apply {
                    setTextColor(onPrimary)
                    background = GradientDrawable().apply { setColor(primary); cornerRadius = 12 * d }
                    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)).apply { topMargin = dp(8) }
                }
                col.addView(head); col.addView(desc); col.addView(media); col.addView(cta)
                container.addView(col)
                val view = NativeAdView.Builder(container)
                    .withLogo(logo).withTitle(title).withSponsored(sponsored)
                    .withDescription(desc).withCtaButton(cta).withMedia(media).build()
                try {
                    Tapsell.requestNativeAd(zone, activity, object : RequestResultListener {
                        override fun onSuccess(id: String) {
                            adId = id
                            try {
                                Tapsell.showNativeAd(id, view, activity, object : AdStateListener.Native {
                                    override fun onAdImpression() { container.visibility = View.VISIBLE; loaded = true }
                                    override fun onAdClicked() {}
                                    override fun onAdFailed(message: String) { container.visibility = View.GONE }
                                })
                                container.visibility = View.VISIBLE
                            } catch (_: Throwable) {}
                        }
                        override fun onFailure(message: String) {}
                    })
                } catch (_: Throwable) {}
                container
            },
        )
    }
}
