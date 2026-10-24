package ir.pptsaz.app

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

fun String.faStr(): String = map { if (it in '0'..'9') '۰' + (it - '0') else it }.joinToString("")

fun hexColor(hex: String?, fallback: Color = Color(0xFF2563EB)): Color = try {
    Color(android.graphics.Color.parseColor("#" + hex!!.trimStart('#')))
} catch (e: Exception) {
    fallback
}

@Composable
fun AppIcon(icon: ImageVector, modifier: Modifier = Modifier, tint: Color = LocalContentColor.current, size: Dp = 24.dp) {
    Icon(icon, contentDescription = null, modifier = modifier.size(size), tint = tint)
}

@Composable
fun SurfaceCard(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surface,
    borderColor: Color? = MaterialTheme.colorScheme.outlineVariant,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(24.dp)
    val bs = if (borderColor != null) BorderStroke(1.dp, borderColor) else null
    if (onClick != null) {
        Surface(onClick = onClick, modifier = modifier, shape = shape, color = color, border = bs) { Column(content = content) }
    } else {
        Surface(modifier = modifier, shape = shape, color = color, border = bs) { Column(content = content) }
    }
}

@Composable
fun GradientButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = null,
) {
    val shape = RoundedCornerShape(18.dp)
    val cs = MaterialTheme.colorScheme
    val bg = if (enabled) Modifier.background(LocalExtra.current.brand, shape) else Modifier.background(cs.onSurface.copy(alpha = 0.12f), shape)
    val fg = if (enabled) Color.White else cs.onSurface.copy(alpha = 0.38f)
    Row(
        modifier.height(56.dp).clip(shape).then(bg)
            .clickable(enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(22.dp), color = fg, strokeWidth = 2.5.dp)
        } else {
            if (icon != null) {
                AppIcon(icon, tint = fg, size = 22.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text(text, color = fg, style = MaterialTheme.typography.titleMedium)
        }
    }
}

@Composable
fun SoftButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    FilledTonalButton(onClick = onClick, modifier = modifier.height(48.dp), enabled = enabled, shape = RoundedCornerShape(16.dp)) {
        if (icon != null) {
            AppIcon(icon, size = 20.dp)
            Spacer(Modifier.width(8.dp))
        }
        Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun SelectChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, locked: Boolean = false, leading: (@Composable () -> Unit)? = null) {
    val cs = MaterialTheme.colorScheme
    val bg = animateColorAsState(if (selected) cs.primaryContainer else cs.surfaceVariant, label = "chipBg").value
    val shape = RoundedCornerShape(14.dp)
    val fg = if (selected) cs.onPrimaryContainer else cs.onSurfaceVariant
    Row(
        modifier.clip(shape).background(bg)
            .border(1.5.dp, if (selected) cs.primary else Color.Transparent, shape)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        leading?.invoke()
        Text(label, style = MaterialTheme.typography.labelLarge, color = fg, maxLines = 1)
        if (locked) AppIcon(AppIcons.Lock, tint = fg, size = 14.dp)
    }
}

/** انتخاب‌گر قطعه‌ای؛ اگر گزینه‌ها زیاد باشند به ردیف قابل اسکرول تبدیل می‌شود. */
@Composable
fun <T> Segmented(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit, locked: (T) -> Boolean = { false }) {
    val cs = MaterialTheme.colorScheme
    if (options.size > 7) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(options) { o -> SelectChip(label(o), o == selected, { onSelect(o) }, locked = locked(o)) }
        }
        return
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(cs.surfaceVariant).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        options.forEach { o ->
            val sel = o == selected
            val lk = locked(o)
            val bg = animateColorAsState(if (sel) cs.primary else Color.Transparent, label = "seg").value
            val fg = if (sel) cs.onPrimary else cs.onSurfaceVariant
            Row(
                Modifier.weight(1f).height(42.dp).clip(RoundedCornerShape(12.dp)).background(bg)
                    .clickable(role = Role.RadioButton) { onSelect(o) },
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(label(o), color = fg.copy(alpha = if (lk) 0.6f else 1f), style = MaterialTheme.typography.labelLarge, maxLines = 1, textAlign = TextAlign.Center)
                if (lk) {
                    Spacer(Modifier.width(3.dp))
                    AppIcon(AppIcons.Lock, tint = fg.copy(alpha = 0.6f), size = 12.dp)
                }
            }
        }
    }
}

@Composable
fun IconTile(icon: ImageVector, brush: Brush, size: Dp = 44.dp) {
    Box(Modifier.size(size).clip(RoundedCornerShape(size * 0.32f)).background(brush), contentAlignment = Alignment.Center) {
        AppIcon(icon, tint = Color.White, size = size * 0.5f)
    }
}

@Composable
fun Pill(text: String, bg: Color, fg: Color) {
    Text(
        text, color = fg, style = MaterialTheme.typography.labelMedium, maxLines = 1,
        modifier = Modifier.clip(CircleShape).background(bg).padding(horizontal = 10.dp, vertical = 3.dp),
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface, modifier = modifier.padding(horizontal = 4.dp))
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.headlineSmall)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing?.invoke()
    }
}

@Composable
fun ToggleRow(title: String, subtitle: String? = null, icon: ImageVector? = null, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (icon != null) {
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) { AppIcon(icon, tint = MaterialTheme.colorScheme.onPrimaryContainer, size = 20.dp) }
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
fun OptionCard(title: String, desc: String? = null, selected: Boolean, onClick: () -> Unit, trailing: (@Composable () -> Unit)? = null) {
    val cs = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(18.dp)
    val bg = animateColorAsState(if (selected) cs.primaryContainer.copy(alpha = 0.55f) else cs.surface, label = "optBg").value
    Row(
        Modifier.fillMaxWidth().clip(shape).background(bg)
            .border(1.5.dp, if (selected) cs.primary else cs.outlineVariant, shape)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(24.dp).clip(CircleShape)
                .background(if (selected) cs.primary else Color.Transparent)
                .border(1.5.dp, if (selected) cs.primary else cs.outline, CircleShape),
            contentAlignment = Alignment.Center,
        ) { if (selected) AppIcon(AppIcons.Check, tint = cs.onPrimary, size = 15.dp) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            if (!desc.isNullOrBlank()) Text(desc, style = MaterialTheme.typography.bodySmall, color = cs.onSurfaceVariant)
        }
        trailing?.invoke()
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, text: String, actionLabel: String? = null, onAction: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
    ) {
        Box(Modifier.size(88.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            AppIcon(icon, tint = MaterialTheme.colorScheme.primary, size = 40.dp)
        }
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(4.dp))
            GradientButton(actionLabel, onAction, Modifier.fillMaxWidth(0.7f))
        }
    }
}
