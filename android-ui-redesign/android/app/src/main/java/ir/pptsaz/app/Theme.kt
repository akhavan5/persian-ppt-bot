package ir.pptsaz.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

val Vazir = FontFamily(
    Font(R.font.vazirmatn_regular, FontWeight.Normal),
    Font(R.font.vazirmatn_regular, FontWeight.Medium),
    Font(R.font.vazirmatn_bold, FontWeight.SemiBold),
    Font(R.font.vazirmatn_bold, FontWeight.Bold),
)

/** رنگ‌های تکمیلی که در ColorScheme نیستند */
class Extra(val brand: Brush, val success: Color, val successBg: Color, val warn: Color, val warnBg: Color)

private val LightExtra = Extra(
    brand = Brush.linearGradient(listOf(Color(0xFF2563EB), Color(0xFF06B6D4))),
    success = Color(0xFF15803D), successBg = Color(0xFFDCFCE7),
    warn = Color(0xFFB45309), warnBg = Color(0xFFFEF3C7),
)
private val DarkExtra = Extra(
    brand = Brush.linearGradient(listOf(Color(0xFF3B6FF0), Color(0xFF0EA5C4))),
    success = Color(0xFF4ADE80), successBg = Color(0xFF12301F),
    warn = Color(0xFFFBBF24), warnBg = Color(0xFF3A2C0B),
)

val LocalExtra = staticCompositionLocalOf { LightExtra }

private val LightColors = lightColorScheme(
    primary = Color(0xFF2563EB), onPrimary = Color.White,
    primaryContainer = Color(0xFFE3ECFF), onPrimaryContainer = Color(0xFF0B2A6F),
    secondary = Color(0xFF06B6D4), onSecondary = Color.White,
    secondaryContainer = Color(0xFFD6F5FB), onSecondaryContainer = Color(0xFF064A57),
    background = Color(0xFFF5F7FC), onBackground = Color(0xFF0F172A),
    surface = Color.White, onSurface = Color(0xFF0F172A),
    surfaceVariant = Color(0xFFEEF2FB), onSurfaceVariant = Color(0xFF5B6678),
    outline = Color(0xFFCBD5E1), outlineVariant = Color(0xFFE2E8F0),
    error = Color(0xFFDC2626), errorContainer = Color(0xFFFEE2E2), onErrorContainer = Color(0xFF7F1D1D),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFF8FAFF),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF1F4FB), surfaceContainerHighest = Color(0xFFEAEFF9),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF7AA2FF), onPrimary = Color(0xFF0A1B4D),
    primaryContainer = Color(0xFF1E3A8A), onPrimaryContainer = Color(0xFFDCE6FF),
    secondary = Color(0xFF22D3EE), onSecondary = Color(0xFF00363F),
    secondaryContainer = Color(0xFF0B4A57), onSecondaryContainer = Color(0xFFCFF6FF),
    background = Color(0xFF0B0F1A), onBackground = Color(0xFFE6EAF2),
    surface = Color(0xFF121826), onSurface = Color(0xFFE6EAF2),
    surfaceVariant = Color(0xFF1B2336), onSurfaceVariant = Color(0xFF98A3B8),
    outline = Color(0xFF334155), outlineVariant = Color(0xFF253047),
    error = Color(0xFFF87171), errorContainer = Color(0xFF4A1414), onErrorContainer = Color(0xFFFFDAD6),
    surfaceContainerLowest = Color(0xFF0B0F1A), surfaceContainerLow = Color(0xFF0F1422),
    surfaceContainer = Color(0xFF121826), surfaceContainerHigh = Color(0xFF1B2336), surfaceContainerHighest = Color(0xFF232D44),
)

private fun TextStyle.v(w: FontWeight? = null) = copy(fontFamily = Vazir, fontWeight = w ?: fontWeight)

private val AppTypography = Typography().let { t ->
    Typography(
        displayLarge = t.displayLarge.v(), displayMedium = t.displayMedium.v(), displaySmall = t.displaySmall.v(),
        headlineLarge = t.headlineLarge.v(FontWeight.Bold), headlineMedium = t.headlineMedium.v(FontWeight.Bold),
        headlineSmall = t.headlineSmall.v(FontWeight.Bold),
        titleLarge = t.titleLarge.v(FontWeight.Bold), titleMedium = t.titleMedium.v(FontWeight.SemiBold),
        titleSmall = t.titleSmall.v(FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.v(), bodyMedium = t.bodyMedium.v(), bodySmall = t.bodySmall.v(),
        labelLarge = t.labelLarge.v(FontWeight.SemiBold), labelMedium = t.labelMedium.v(), labelSmall = t.labelSmall.v(),
    )
}

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp), medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    CompositionLocalProvider(LocalExtra provides (if (dark) DarkExtra else LightExtra)) {
        MaterialTheme(
            colorScheme = if (dark) DarkColors else LightColors,
            typography = AppTypography,
            shapes = AppShapes,
            content = content,
        )
    }
}
