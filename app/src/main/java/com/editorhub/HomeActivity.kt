package com.editorhub

import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.method.ScrollingMovementMethod
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity

/**
 * The launcher, deliberately built out of plain views.
 *
 * WHY NOT COMPOSE
 *
 * The editor screen is Compose. If a fault in that screen kills the process on startup, a
 * Compose launcher cannot report it, because the report and the launcher die together. This
 * screen uses nothing but `LinearLayout`, `TextView` and `Button`: no Compose, no WebView, no
 * document store, no bitmap. There is almost nothing here that can fail, which is exactly the
 * requirement for a screen whose job is to hand over a crash report and get the user back into
 * a working editor.
 *
 * It also gives the native editor a second door. Anything the native screen does wrong now
 * costs one screen, not the app.
 */
class HomeActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0B0D10"))
            setPadding(dp(20), dp(28), dp(20), dp(20))
        }

        root.addView(TextView(this).apply {
            text = "EditorsHub"
            setTextColor(Color.parseColor("#E9EDF2"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTypeface(typeface, Typeface.BOLD)
        })

        val report = CrashLog.pending(this)
        if (report != null) {
            root.addView(TextView(this).apply {
                text = "The editor stopped unexpectedly last time. The details are below."
                setTextColor(Color.parseColor("#FFC857"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, dp(8), 0, dp(10))
            })
            root.addView(ScrollView(this).apply {
                setBackgroundColor(Color.parseColor("#14181D"))
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
                )
                addView(TextView(this@HomeActivity).apply {
                    text = report
                    setTextColor(Color.parseColor("#C9D2DC"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 9.5f)
                    typeface = Typeface.MONOSPACE
                    setPadding(dp(10), dp(10), dp(10), dp(10))
                    movementMethod = ScrollingMovementMethod()
                    setTextIsSelectable(true)
                })
            })
        } else {
            root.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
                )
            })
        }

        // Buttons, last so they are always reachable regardless of how long the trace is.
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
        }

        if (report != null) {
            actions.addView(button("Send report") {
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "EditorsHub crash report")
                    putExtra(Intent.EXTRA_TEXT, report)
                }
                runCatching { startActivity(Intent.createChooser(intent, "Send crash report")) }
            })
        }
        actions.addView(button("Editor") { open(MainActivity::class.java) })
        actions.addView(button("Effects editor") { open(EditorActivity::class.java) })
        root.addView(actions)

        setContentView(root)
    }

    private fun open(target: Class<*>) {
        runCatching { startActivity(Intent(this, target)) }
    }

    private fun button(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(Color.parseColor("#0B0D10"))
            setBackgroundColor(Color.parseColor("#3AD9C6"))
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                .also { it.setMargins(dp(4), 0, dp(4), 0) }
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
