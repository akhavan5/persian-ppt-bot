package ir.pptsaz.app

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** یک نظر منتشرشده‌ی کاربر (فقط نام کوچک و متن) */
private class PubReview(val name: String, val src: String, val text: String, val stars: Int)

/** آمار عمومی سرویس */
private class PubStats(val users: Long, val decks: Long, val plans: Long)

/** نتیجه‌ی آخرین دریافت؛ تا ۳۰ دقیقه با هر بار باز شدن تب «حساب» دوباره از سرور نمی‌گیریم */
private object CommunityCache {
    var at = 0L
    var stats: PubStats? = null
    var reviews: List<PubReview> = emptyList()
    var avg = ""; var cnt = ""; var stores: List<String> = emptyList()
    fun fresh() = at > 0 && System.currentTimeMillis() - at < 30 * 60_000
}

/** مقدار گرد‌شده مثل صفحه‌ی اصلی سایت: زیر هزار همان عدد، بالاتر صدگان گرد و «+» */
private fun niceCount(n: Long): String {
    fun group(x: Long) = x.toString().reversed().chunked(3).joinToString("٬").reversed().faStr()
    return when {
        n < 1000 -> group(n)
        n < 1_000_000 -> group(n / 100 * 100) + "+"
        else -> (n / 100_000 / 10.0).toString().faStr().replace(".", "٫") + " میلیون+"
    }
}

/** کارت «آمار و نظرات کاربران» در تب حساب؛ هر خطا ⇒ هیچ‌چیز نمایش داده نمی‌شود (صفحه سالم می‌ماند) */
@Composable
fun CommunityCard() {
    var stats by remember { mutableStateOf(CommunityCache.stats) }
    var reviews by remember { mutableStateOf(CommunityCache.reviews) }
    var avg by remember { mutableStateOf(CommunityCache.avg) }
    var cnt by remember { mutableStateOf(CommunityCache.cnt) }
    var stores by remember { mutableStateOf(CommunityCache.stores) }

    LaunchedEffect(Unit) {
        if (CommunityCache.fresh()) return@LaunchedEffect
        var got = false
        try {
            val j = Api.publicStats()
            val s = PubStats(j.optLong("users"), j.optLong("decks"), j.optLong("plans"))
            if (s.users > 0 || s.decks > 0 || s.plans > 0) stats = s
            got = true
        } catch (_: Exception) {}
        try {
            val j = Api.publicReviews()
            val arr = j.optJSONArray("items")
            val list = ArrayList<PubReview>()
            if (arr != null) for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                val t = o.optString("t")
                if (t.isNotBlank()) list += PubReview(o.optString("n", "کاربر"), o.optString("s"), t, o.optInt("r"))
            }
            val r = j.optJSONObject("rating")
            if (r != null) {
                avg = r.optString("avg"); cnt = r.optString("count")
                stores = listOf("مایکت " + r.optString("myket"), "کافه‌بازار " + r.optString("bazaar"))
            }
            reviews = list
        } catch (_: Exception) { got = false }
        if (got) {
            CommunityCache.stats = stats; CommunityCache.reviews = reviews; CommunityCache.avg = avg
            CommunityCache.cnt = cnt; CommunityCache.stores = stores; CommunityCache.at = System.currentTimeMillis()
        }
    }

    stats?.let { StatsRow(it) }
    if (reviews.isNotEmpty()) ReviewsSlider(reviews, avg, cnt, stores)
}

@Composable
private fun StatsRow(s: PubStats) {
    val cs = MaterialTheme.colorScheme
    val items = listOf("👥" to ("کاربر" to s.users), "📊" to ("ارائه ساخته‌شده" to s.decks), "👑" to ("پلن فعال‌شده" to s.plans)).filter { it.second.second > 0 }
    SectionTitle("پاورپوینت‌ساز در یک نگاه", Modifier.padding(top = 4.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { (emoji, p) ->
            SurfaceCard(Modifier.weight(1f)) {
                Column(Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(emoji, style = MaterialTheme.typography.titleLarge)
                    Text(niceCount(p.second), style = MaterialTheme.typography.titleMedium, color = cs.primary, maxLines = 1)
                    Text(p.first, style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

@Composable
private fun ReviewsSlider(list: List<PubReview>, avg: String, cnt: String, stores: List<String>) {
    val cs = MaterialTheme.colorScheme
    val gold = Color(0xFFF5A524)
    val pager = rememberPagerState(pageCount = { list.size })
    val scope = rememberCoroutineScope()
    var userTouched by remember { mutableStateOf(0) }

    fun go(i: Int) { scope.launch { pager.animateScrollToPage(((i % list.size) + list.size) % list.size) } }

    // پخش خودکار هر ۵ ثانیه؛ با لمس/کشیدن کاربر ۸ ثانیه مکث می‌کند
    LaunchedEffect(userTouched, list.size) {
        if (list.size < 2) return@LaunchedEffect
        delay(if (userTouched == 0) 5000 else 8000)
        while (true) {
            if (!pager.isScrollInProgress) go(pager.currentPage + 1)
            delay(5000)
        }
    }
    val dragged by pager.interactionSource.collectIsDraggedAsState()
    LaunchedEffect(dragged) { if (dragged) userTouched++ }

    SectionTitle("کاربران چه می‌گویند؟", Modifier.padding(top = 4.dp))
    SurfaceCard {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (avg.isNotBlank()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(avg, style = MaterialTheme.typography.headlineMedium)
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("★★★★★", color = gold, style = MaterialTheme.typography.titleSmall)
                        Text("از ${cnt.faStr()} امتیاز کاربران", style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
                    }
                }
                if (stores.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    stores.forEach { Text(it, Modifier.clip(RoundedCornerShape(99.dp)).background(cs.surfaceVariant).padding(horizontal = 10.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall) }
                }
            }
            // اسلایدر واقعی: کشیدن با لمس در هر دو جهت (جهت راست‌به‌چپ را خود Pager از LayoutDirection می‌گیرد)
            HorizontalPager(state = pager, modifier = Modifier.fillMaxWidth(), pageSpacing = 12.dp, verticalAlignment = Alignment.Top) { i ->
                val v = list[i]
                Surface(Modifier.fillMaxWidth().height(172.dp), shape = RoundedCornerShape(18.dp), color = cs.surfaceVariant.copy(alpha = 0.5f), border = BorderStroke(1.dp, cs.outlineVariant)) {
                    Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (v.stars > 0) Text("★".repeat(v.stars) + "☆".repeat(5 - v.stars), color = gold, style = MaterialTheme.typography.labelLarge)
                        Text("«${v.text}»", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 5, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(Modifier.size(28.dp).clip(CircleShape).background(cs.primary), contentAlignment = Alignment.Center) {
                                Text(v.name.trim().firstOrNull()?.toString() ?: "ک", color = cs.onPrimary, style = MaterialTheme.typography.labelLarge)
                            }
                            Text(v.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, modifier = Modifier.weight(1f, fill = false))
                            Box(Modifier.weight(1f))
                            if (v.src.isNotBlank()) Text(v.src, Modifier.clip(RoundedCornerShape(99.dp)).background(cs.surface).padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall, color = cs.onSurfaceVariant, maxLines = 1)
                        }
                    }
                }
            }
            if (list.size > 1) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                // قبلی: سمت راست و فلش به راست؛ بعدی: سمت چپ و فلش به چپ
                NavCircle(rotate = true, desc = "نظر قبلی") { userTouched++; go(pager.currentPage - 1) }
                Box(Modifier.weight(1f, fill = false).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    if (list.size <= 12) Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        list.indices.forEach { i ->
                            val on = i == pager.currentPage
                            Box(Modifier.height(7.dp).width(if (on) 18.dp else 7.dp).clip(CircleShape).background(if (on) cs.primary else cs.outlineVariant))
                        }
                    } else Text("${(pager.currentPage + 1).toString().faStr()} / ${list.size.toString().faStr()}", style = MaterialTheme.typography.labelMedium, color = cs.onSurfaceVariant)
                }
                NavCircle(rotate = false, desc = "نظر بعدی") { userTouched++; go(pager.currentPage + 1) }
            }
        }
    }
}

@Composable
private fun NavCircle(rotate: Boolean, desc: String, onClick: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    Box(Modifier.size(38.dp).clip(CircleShape).background(cs.surfaceVariant).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        AppIcon(AppIcons.ChevronLeft, Modifier.then(if (rotate) Modifier.rotate(180f) else Modifier), tint = cs.primary, size = 22.dp, description = desc)
    }
}
