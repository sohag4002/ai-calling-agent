package com.aivoice.gateway

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.util.Log
import androidx.core.app.NotificationCompat
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

class CallGatewayService : Service() {

    companion object {
        var isRunning = false
        var isExplicitlyStopped = false
        var onLogListener: ((String) -> Unit)? = null
        var onStatusListener: ((Boolean, String) -> Unit)? = null
        private const val CHANNEL_ID = "ai_call_gateway_channel"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "CallGatewayService"

        fun log(msg: String) {
            Log.d(TAG, msg)
            onLogListener?.invoke(msg)
        }
    }

    private var socket: Socket? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var telephonyManager: TelephonyManager? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var audioBridge: CallAudioBridge? = null

    private var currentLeadId: String? = null
    private var currentPhone: String? = null
    private var currentName: String? = null
    private var isCallActive = false
    private var currentServerUrl: String = "http://192.168.1.225:5050"

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        isExplicitlyStopped = false
        onStatusListener?.invoke(true, "সক্রিয় ও কানেক্টেড ✅")

        try {
            createNotificationChannel()
            val notification = buildNotification("AI Call Gateway সক্রিয় ও ২৪/৭ ব্যাকগ্রাউন্ডে চলছে...")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            Log.e(TAG, "startForeground error: ${e.message}")
        }

        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIGateway::WakeLock")?.apply {
                acquire(24 * 60 * 60 * 1000L) // 24 hours persistent
            }
        } catch (e: Exception) {
            Log.e(TAG, "WakeLock error: ${e.message}")
        }

        try {
            telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            setupPhoneStateListener()
        } catch (e: Exception) {
            Log.e(TAG, "Telephony setup error: ${e.message}")
        }

        try {
            audioBridge = CallAudioBridge(this)
        } catch (e: Exception) {
            Log.e(TAG, "Audio bridge setup error: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = getSharedPreferences("ai_gateway_prefs", Context.MODE_PRIVATE)
        val urlFromIntent = intent?.getStringExtra("SERVER_URL")
        if (!urlFromIntent.isNullOrEmpty()) {
            currentServerUrl = urlFromIntent
            prefs.edit().putString("server_url", urlFromIntent).putBoolean("service_enabled", true).apply()
        } else {
            currentServerUrl = prefs.getString("server_url", "http://192.168.1.225:5050") ?: "http://192.168.1.225:5050"
        }

        isExplicitlyStopped = false
        log("সার্ভার কানেক্ট হচ্ছে: $currentServerUrl")
        connectSocket(currentServerUrl)
        return START_STICKY
    }

    private fun connectSocket(serverUrl: String) {
        try {
            socket?.disconnect()
            val opts = IO.Options().apply {
                reconnection = true
                reconnectionDelay = 1500
                reconnectionDelayMax = 4000
                timeout = 15000
                transports = arrayOf("websocket", "polling")
            }
            socket = IO.socket(serverUrl, opts)

            socket?.on(Socket.EVENT_CONNECT) {
                log("সার্ভারের সাথে সফলভাবে কানেক্টেড! ✅")
                onStatusListener?.invoke(true, "সক্রিয় ও কানেক্টেড ✅")
                updateNotification("সার্ভারের সাথে সক্রিয় ও কানেক্টেড ✅")

                val registerData = JSONObject().apply {
                    put("type", "android_gateway")
                    put("timestamp", System.currentTimeMillis())
                    put("deviceName", Build.MODEL)
                    put("simSlot", 1)
                }
                socket?.emit("register_android_gateway", registerData)
                socket?.emit("register_gateway", registerData)
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val err = if (args.isNotEmpty()) args[0].toString() else "কানেকশন সমস্যা"
                log("সার্ভার কানেকশন চেষ্টা চলছে... ⚠️")
                onStatusListener?.invoke(true, "কানেকশন চেষ্টা চলছে... ⚠️")
                updateNotification("সার্ভার কানেকশন চেষ্টা চলছে...")
            }

            val handleDial = { args: Array<Any> ->
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val data = args[0] as JSONObject
                    val leadId = data.optString("leadId")
                    val phone = data.optString("phone")
                    val name = data.optString("name", "সম্মানিত কাস্টমার")
                    val openingSpeech = data.optString("openingSpeech", "আসসালামু আলাইকুম! কেমন আছেন?")

                    log("📞 অটো-কল ডায়াল হচ্ছে: $name ($phone)")
                    handleIncomingDialRequest(leadId, phone, name, openingSpeech)
                }
            }

            socket?.on("dial_lead") { args -> handleDial(args) }
            socket?.on("dial_call") { args -> handleDial(args) }

            socket?.on("ai_speech_reply") { args ->
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val data = args[0] as JSONObject
                    val replyText = data.optString("replyText")
                    log("🤖 AI উত্তর: $replyText")
                    audioBridge?.speakBengali(replyText)
                }
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                log("সার্ভার থেকে ডিসকানেক্টেড (পুনরায় চেষ্টা চলছে...)")
                onStatusListener?.invoke(true, "সার্ভার বিচ্ছিন্ন (পুনরায় চেষ্টা চলছে) ⚠️")
                updateNotification("সার্ভার থেকে বিচ্ছিন্ন (পুনরায় চেষ্টা চলছে...)")
            }

            socket?.connect()
        } catch (e: Exception) {
            log("সকেট ইনিশিয়ালাইজেশন ত্রুটি: ${e.message}")
            Log.e(TAG, "Socket init failed: ${e.message}")
        }
    }

    private fun handleIncomingDialRequest(leadId: String, phone: String, name: String, openingSpeech: String) {
        currentLeadId = leadId
        currentPhone = phone
        currentName = name

        Log.d(TAG, "Initiating Call to $phone ($name)")
        updateNotification("ডায়াল করা হচ্ছে: $name ($phone)...")

        try {
            audioBridge?.setInitialSpeech(openingSpeech)

            val callIntent = Intent(Intent.ACTION_CALL).apply {
                data = Uri.parse("tel:$phone")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
                // Automatically bypass SIM selector on Dual SIM phones
                putExtra("com.android.phone.force.slot", true)
                putExtra("Cdma_Supp", true)
                putExtra("simSlot", 0) // Primary SIM Slot (SIM 1)
                putExtra("slot", 0)
                putExtra("com.android.phone.extra.slot", 0)
                putExtra("sim_slot", 0)
                putExtra("subscription", 1)
            }
            startActivity(callIntent)
        } catch (e: Exception) {
            log("কল ডায়াল করতে ত্রুটি (Phone Call পারমিশন দিন): ${e.message}")
        }
    }

    @Suppress("DEPRECATION")
    private fun setupPhoneStateListener() {
        try {
            phoneStateListener = object : PhoneStateListener() {
                override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                    super.onCallStateChanged(state, phoneNumber)
                    when (state) {
                        TelephonyManager.CALL_STATE_OFFHOOK -> {
                            isCallActive = true
                            log("কল রিসিভ হয়েছে! লাইভ AI কথোপকথন শুরু হচ্ছে... 🎙️")
                            updateNotification("লাইভ AI কথোপকথন চলছে: $currentPhone")

                            audioBridge?.startLiveConversation { userSpeech ->
                                val payload = JSONObject().apply {
                                    put("leadId", currentLeadId)
                                    put("phone", currentPhone)
                                    put("userSpeech", userSpeech)
                                }
                                socket?.emit("process_speech", payload)
                            }
                        }
                        TelephonyManager.CALL_STATE_IDLE -> {
                            if (isCallActive) {
                                isCallActive = false
                                log("কল সম্পন্ন হয়েছে। সামারি পাঠানো হচ্ছে...")
                                audioBridge?.stopLiveConversation()

                                val result = JSONObject().apply {
                                    put("leadId", currentLeadId)
                                    put("phone", currentPhone)
                                    put("leadName", currentName)
                                    put("outcome", "completed")
                                    put("durationSeconds", audioBridge?.getCallDurationSeconds() ?: 0)
                                    put("transcript", audioBridge?.getFullTranscript() ?: "")
                                }
                                socket?.emit("call_finished", result)
                                updateNotification("সার্ভারের সাথে সক্রিয় ও কানেক্টেড ✅")
                            }
                        }
                    }
                }
            }
            telephonyManager?.listen(phoneStateListener, PhoneStateListener.LISTEN_CALL_STATE)
        } catch (e: Exception) {
            Log.e(TAG, "Phone state listener error: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AI Voice Calling Gateway",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "AI Voice Calling Gateway Persistent Background Service"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI Voice Call Gateway")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun updateNotification(text: String) {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(NOTIFICATION_ID, buildNotification(text))
        } catch (e: Exception) {
            Log.e(TAG, "Notification update error: ${e.message}")
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "onTaskRemoved triggered: app swiped from recents. Keeping service alive!")
        val restartIntent = Intent(applicationContext, CallGatewayService::class.java).apply {
            putExtra("SERVER_URL", currentServerUrl)
        }
        val pendingIntent = PendingIntent.getService(
            applicationContext,
            1,
            restartIntent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )
        val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        alarmManager?.set(
            AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + 1000,
            pendingIntent
        )
        super.onTaskRemoved(rootIntent)
    }

    @Suppress("DEPRECATION")
    override fun onDestroy() {
        if (isExplicitlyStopped) {
            isRunning = false
            onStatusListener?.invoke(false, "স্ট্যাটাস: বন্ধ ❌")
            try {
                wakeLock?.release()
            } catch (e: Exception) {}
            try {
                socket?.disconnect()
            } catch (e: Exception) {}
            try {
                audioBridge?.destroy()
            } catch (e: Exception) {}
            try {
                phoneStateListener?.let { telephonyManager?.listen(it, PhoneStateListener.LISTEN_NONE) }
            } catch (e: Exception) {}
        } else {
            // Restart automatically if killed by system
            val broadcastIntent = Intent(this, BootReceiver::class.java)
            sendBroadcast(broadcastIntent)
        }
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
