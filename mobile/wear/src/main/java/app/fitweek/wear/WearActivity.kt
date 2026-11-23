package app.fitweek.wear

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

/**
 * Schermata al polso: esercizio e serie proposti dal telefono, ripetizioni da correggere con la corona o con
 * −/+, "Serie fatta", recupero con vibrazione alla fine, battito. Tutte le regole (cosa proporre, cosa salvare)
 * restano sul telefono: l'orologio mostra lo stato che riceve e rimanda i tocchi.
 */
class WearActivity : Activity(), MessageClient.OnMessageReceivedListener {
    private val ui = Handler(Looper.getMainLooper())
    private var state = JSONObject()
    private var reps = 0
    private var restAlerted = 0L
    private var scrollAcc = 0f

    private lateinit var title: TextView
    private lateinit var detail: TextView
    private lateinit var repsText: TextView
    private lateinit var repsRow: LinearLayout
    private lateinit var rest: TextView
    private lateinit var heart: TextView
    private lateinit var action: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(layout())
        val missing = arrayOf(Manifest.permission.BODY_SENSORS, Manifest.permission.ACTIVITY_RECOGNITION, Manifest.permission.POST_NOTIFICATIONS)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)
        show()
    }

    override fun onResume() {
        super.onResume()
        Wearable.getMessageClient(this).addListener(this)
        Link.send(this, Link.HELLO, "")
        ui.post(tick)
    }

    override fun onPause() {
        super.onPause()
        Wearable.getMessageClient(this).removeListener(this)
        ui.removeCallbacks(tick)
    }

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != Link.STATE) return
        val next = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull() ?: return
        runOnUiThread {
            val newSet = next.optString("exId") != state.optString("exId") || next.optInt("idx") != state.optInt("idx")
            state = next
            if (newSet) reps = next.optInt("reps", 0)
            if (next.optBoolean("active")) {
                if (checkSelfPermission(Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED) ExerciseService.start(this)
            } else ExerciseService.stop(this)
            show()
        }
    }

    /** La corona (o la ghiera) cambia le ripetizioni di uno per scatto, prima che la usi lo scorrimento. */
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_SCROLL && event.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER) && state.optBoolean("active")) {
            scrollAcc += -event.getAxisValue(MotionEvent.AXIS_SCROLL)
            if (kotlin.math.abs(scrollAcc) >= 1f) {
                changeReps(if (scrollAcc > 0) 1 else -1)
                scrollAcc = 0f
            }
            return true
        }
        return super.dispatchGenericMotionEvent(event)
    }

    private fun changeReps(delta: Int) {
        reps = (reps + delta).coerceIn(0, 100)
        show()
    }

    private fun onAction() {
        if (!state.optBoolean("active")) {
            Link.send(this, Link.START, "")
            action.text = "Avvio…"
            return
        }
        if (state.optString("exId").isEmpty()) return
        val set = JSONObject().put("exId", state.optString("exId")).put("idx", state.optInt("idx"))
            .put("kg", if (state.isNull("kg")) JSONObject.NULL else state.optDouble("kg")).put("reps", reps)
        Link.send(this, Link.SET, set.toString())
        action.text = "Inviata"
        action.isEnabled = false // si riabilita col prossimo stato dal telefono
    }

    private val tick = object : Runnable {
        override fun run() {
            showRest()
            heart.text = if (ExerciseService.latestBpm > 0) "♥ ${ExerciseService.latestBpm}" else ""
            ui.postDelayed(this, 1000)
        }
    }

    private fun showRest() {
        val end = state.optLong("restEnd", 0L)
        val left = (end - System.currentTimeMillis()) / 1000
        rest.visibility = if (end > 0 && left > -5) View.VISIBLE else View.GONE
        rest.text = if (left > 0) "Recupero %d:%02d".format(left / 60, left % 60) else "Pronto: ${state.optString("exercise")}"
        if (end > 0 && left <= 0 && restAlerted != end) {
            restAlerted = end
            getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 250, 120, 250), -1))
        }
    }

    private fun show() {
        val active = state.optBoolean("active")
        val hasSet = active && state.optString("exId").isNotEmpty()
        title.text = when {
            hasSet -> state.optString("exercise")
            active -> "Esercizi completati"
            else -> "FitWeek"
        }
        detail.text = when {
            hasSet -> {
                val kg = if (state.isNull("kg")) "" else " · %s kg".format(fmt(state.optDouble("kg")))
                "Serie ${state.optInt("idx")} di ${state.optInt("planned")}$kg"
            }
            active -> "Termina la seduta dal telefono"
            state.has("routine") -> "Oggi: giorno ${state.optString("routine")}"
            else -> "Apri FitWeek sul telefono"
        }
        repsRow.visibility = if (hasSet) View.VISIBLE else View.GONE
        repsText.text = "$reps rip."
        action.visibility = if (hasSet || !active) View.VISIBLE else View.GONE
        action.isEnabled = true
        action.text = if (active) "Serie fatta" else "Inizia seduta"
        showRest()
    }

    private fun fmt(kg: Double) = if (kg % 1.0 == 0.0) kg.toInt().toString() else kg.toString().replace('.', ',')

    private fun text(size: Float, bold: Boolean = false) = TextView(this).apply {
        textSize = size
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun button(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
    }

    private fun layout(): View {
        title = text(16f, bold = true)
        detail = text(13f)
        repsText = text(20f, bold = true)
        rest = text(14f)
        heart = text(13f)
        repsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(button("−") { changeReps(-1) })
            addView(repsText, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { setMargins(16, 0, 16, 0) })
            addView(button("+") { changeReps(1) })
        }
        action = button("Inizia seduta") { onAction() }
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24, 36, 24, 48) // margini per lo schermo tondo
            listOf(title, detail, repsRow, action, rest, heart).forEach { addView(it) }
        }
        return ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.BLACK)
            addView(column)
            requestFocus() // la corona arriva alla vista con il fuoco
        }
    }
}
