package app.fitweek.wear

import android.content.Context
import com.google.android.gms.wearable.Wearable

/**
 * Messaggi tra orologio e telefono (Data Layer). Stessi percorsi in static/js/wear.js e nel plugin WatchLink.
 *  /fitweek/hello  orologio → telefono: "mandami lo stato"
 *  /fitweek/state  telefono → orologio: JSON {active, routine, exercise, exId, idx, planned, kg, reps, restEnd}
 *  /fitweek/start  orologio → telefono: avvia la seduta di oggi
 *  /fitweek/set    orologio → telefono: JSON {exId, idx, kg, reps} serie fatta
 *  /fitweek/hr     orologio → telefono: "bpm,epochMs" (più campioni separati da ";")
 */
object Link {
    const val HELLO = "/fitweek/hello"
    const val STATE = "/fitweek/state"
    const val START = "/fitweek/start"
    const val SET = "/fitweek/set"
    const val HR = "/fitweek/hr"

    /** Manda a tutti i telefoni collegati; se nessuno risponde il messaggio si perde (il telefono rimanda lo stato). */
    fun send(context: Context, path: String, payload: String) {
        val nodes = Wearable.getNodeClient(context)
        val messages = Wearable.getMessageClient(context)
        nodes.connectedNodes.addOnSuccessListener { list ->
            for (node in list) messages.sendMessage(node.id, path, payload.toByteArray(Charsets.UTF_8))
        }
    }
}
