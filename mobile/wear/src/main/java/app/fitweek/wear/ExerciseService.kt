package app.fitweek.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.SystemClock
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import java.time.Instant

/**
 * Seduta di allenamento di Health Services (forza): il battito arriva anche a schermo spento finché il servizio
 * è in primo piano. Ogni campione va al telefono, raggruppato al massimo ogni 2 secondi.
 */
class ExerciseService : Service() {
    private val client by lazy { HealthServices.getClient(this).exerciseClient }
    private val pending = StringBuilder()
    private var lastSent = 0L

    private val callback = object : ExerciseUpdateCallback {
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            val boot = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
            for (point in update.latestMetrics.getData(DataType.HEART_RATE_BPM)) {
                if (pending.isNotEmpty()) pending.append(';')
                pending.append(point.value.toInt()).append(',').append(point.getTimeInstant(boot).toEpochMilli())
            }
            val now = SystemClock.elapsedRealtime()
            if (pending.isNotEmpty() && now - lastSent >= SEND_EVERY_MS) {
                Link.send(this@ExerciseService, Link.HR, pending.toString())
                pending.setLength(0)
                lastSent = now
            }
            latestBpm = update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value?.toInt() ?: latestBpm
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            client.endExerciseAsync()
            client.clearUpdateCallbackAsync(callback)
            running = false
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (!running) {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
            client.setUpdateCallback(callback)
            val config = ExerciseConfig.builder(ExerciseType.STRENGTH_TRAINING)
                .setDataTypes(setOf(DataType.HEART_RATE_BPM))
                .setIsAutoPauseAndResumeEnabled(false)
                .setIsGpsEnabled(false)
                .build()
            client.startExerciseAsync(config)
            running = true
        }
        return START_STICKY
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Seduta in corso", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, WearActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setContentTitle("FitWeek")
            .setContentText("Seduta in corso: battito al telefono")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "fitweek-session"
        private const val NOTIFICATION_ID = 7
        private const val SEND_EVERY_MS = 2000L
        const val ACTION_STOP = "app.fitweek.wear.STOP"
        @Volatile var running = false
        @Volatile var latestBpm = 0

        fun start(context: Context) = context.startForegroundService(Intent(context, ExerciseService::class.java))
        fun stop(context: Context) {
            if (running) context.startService(Intent(context, ExerciseService::class.java).setAction(ACTION_STOP))
        }
    }
}
