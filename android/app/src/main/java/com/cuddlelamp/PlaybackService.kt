package com.cuddlelamp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject

class PlaybackService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var session: MediaSession
    private var lastStatus = -1
    private var lastTitle = ""
    private var stoppedAfterTimer = false
    private val audioRouteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                pausePlayback()
            }
        }
    }
    private val update = object : Runnable {
        override fun run() {
            publishPlayback()
            if (!stoppedAfterTimer) handler.postDelayed(this, 500)
        }
    }

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Воспроизведение", NotificationManager.IMPORTANCE_LOW)
        )
        session = MediaSession(this, "cuddle-lamp").apply {
            setCallback(object : MediaSession.Callback() {
                override fun onPlay() {
                    if (requestFocus()) setNativePlaying(true)
                }

                override fun onPause() {
                    pausePlayback()
                }

                override fun onStop() {
                    stopSelf()
                }
            }, handler)
            isActive = true
        }
        startForeground(NOTIFICATION_ID, createNotification(false, "cuddle-lamp"))
        val routeFilter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(audioRouteReceiver, routeFilter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(audioRouteReceiver, routeFilter)
        }
        handler.post(update)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY -> if (requestFocus()) setNativePlaying(true)
            ACTION_PAUSE -> pausePlayback()
            ACTION_STOP -> stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        unregisterReceiver(audioRouteReceiver)
        handler.removeCallbacks(update)
        if (!stoppedAfterTimer) {
            pausePlayback()
            abandonFocus()
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        session.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun publishPlayback() {
        val snapshot = readNativeSnapshot()?.let { JSONObject(it) } ?: return
        val status = snapshot.getInt("status")
        val title = snapshot.optJSONObject("scene")?.optString("name") ?: "cuddle-lamp"
        if (status == lastStatus && title == lastTitle) return
        val wasAudible = lastStatus == 2 || lastStatus == 3
        lastStatus = status
        lastTitle = title
        val isAudible = status == 2 || status == 3
        if (wasAudible && status == 1 && !resumeAfterFocusLoss) {
            abandonFocus()
            if (snapshot.optBoolean("timerExpired")) {
                stoppedAfterTimer = true
                stopSelf()
                return
            }
        }
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                        PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP
                )
                .setState(
                    if (isAudible) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    PlaybackState.PLAYBACK_POSITION_UNKNOWN,
                    if (isAudible) 1f else 0f,
                )
                .build()
        )
        session.setMetadata(
            android.media.MediaMetadata.Builder()
                .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, title)
                .build()
        )
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, createNotification(isAudible, title))
    }

    private fun createNotification(isPlaying: Boolean, title: String): Notification {
        val launch = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val action = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
        val playPause = PendingIntent.getService(
            this, 1, Intent(this, PlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 2, Intent(this, PlaybackService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val icon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        return Notification.Builder(this, CHANNEL)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0))
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentIntent(launch)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(Notification.Action.Builder(icon, if (isPlaying) "Пауза" else "Воспроизвести", playPause).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Остановить", stop).build())
            .build()
    }

    companion object {
        private const val CHANNEL = "audio_playback"
        private const val NOTIFICATION_ID = 1
        private const val ACTION_PLAY = "com.cuddlelamp.PLAY"
        private const val ACTION_PAUSE = "com.cuddlelamp.PAUSE"
        private const val ACTION_STOP = "com.cuddlelamp.STOP"
        private lateinit var context: Context
        private var focusRequest: AudioFocusRequest? = null
        @Volatile private var resumeAfterFocusLoss = false

        fun initialize(application: Context) {
            context = application.applicationContext
        }

        @JvmStatic fun prepareTransport(playing: Boolean): Boolean {
            resumeAfterFocusLoss = false
            if (!playing) return true
            if (Build.VERSION.SDK_INT < 26 || !requestFocus()) return false
            return try {
                context.startForegroundService(Intent(context, PlaybackService::class.java))
                true
            } catch (_: IllegalStateException) {
                abandonFocus()
                false
            }
        }

        private fun pausePlayback() {
            resumeAfterFocusLoss = false
            setNativePlaying(false)
        }

        @Synchronized private fun requestFocus(): Boolean {
            val manager = context.getSystemService(AudioManager::class.java)
            val request = focusRequest ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
                )
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(::handleFocusChange, Handler(Looper.getMainLooper()))
                .build()
            val granted = manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            if (granted) focusRequest = request
            return granted
        }

        @Synchronized private fun abandonFocus() {
            val request = focusRequest ?: return
            context.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(request)
            focusRequest = null
        }

        private fun handleFocusChange(change: Int) {
            when (change) {
                AudioManager.AUDIOFOCUS_GAIN -> if (resumeAfterFocusLoss) {
                    resumeAfterFocusLoss = false
                    setNativePlaying(true)
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    resumeAfterFocusLoss = resumeAfterFocusLoss ||
                        readNativeSnapshot()?.let { JSONObject(it).optInt("status") == 2 } == true
                    setNativePlaying(false)
                }
                AudioManager.AUDIOFOCUS_LOSS -> {
                    resumeAfterFocusLoss = false
                    setNativePlaying(false)
                    abandonFocus()
                }
            }
        }

        @JvmStatic private external fun setNativePlaying(playing: Boolean): Boolean
        @JvmStatic private external fun readNativeSnapshot(): String?
    }
}
