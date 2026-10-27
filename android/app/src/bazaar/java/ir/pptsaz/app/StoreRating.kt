package ir.pptsaz.app

import android.content.Intent
import android.net.Uri

/** صفحه‌ی ثبت امتیاز و نظر همین اپ در کافه‌بازار (بازار پنجره‌ی امتیاز درون‌برنامه‌ای ندارد؛ صفحه‌ی ثبت نظر باز می‌شود). */
object StoreRating {
    val WEB_URL = "https://cafebazaar.ir/app/" + BuildConfig.APPLICATION_ID + "?l=fa"

    fun intent(): Intent =
        Intent(Intent.ACTION_EDIT, Uri.parse("bazaar://details?id=" + BuildConfig.APPLICATION_ID)).setPackage("com.farsitel.bazaar")
}
