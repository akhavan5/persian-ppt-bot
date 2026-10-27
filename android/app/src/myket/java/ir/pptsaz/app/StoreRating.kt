package ir.pptsaz.app

import android.content.Intent
import android.net.Uri

/** صفحه‌ی ثبت نظر همین اپ در مایکت (پنجره‌ی امتیاز درون‌برنامه‌ای ندارد؛ صفحه‌ی نظر باز می‌شود). */
object StoreRating {
    val WEB_URL = "https://myket.ir/app/" + BuildConfig.APPLICATION_ID

    fun intent(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("myket://comment?id=" + BuildConfig.APPLICATION_ID)).setPackage("ir.mservices.market")
}
