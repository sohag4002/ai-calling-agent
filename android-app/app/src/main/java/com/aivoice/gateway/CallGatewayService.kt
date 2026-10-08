package com.aivoice.gateway

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
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
        private const val CHANNEL_ID = "ai_call_gateway_channel"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "CallGatewayService"
    }

    private var socket: Socket? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private lateinit var telephonyManager: TelephonyManager
    private var audioBridge: CallAudioBridge? = null

    private var currentLeadId: String? = null
    private var currentPhone: String? = null
    private var currentName: String? = null
    private var isCallActive = false

    override fun onCreate() {
        super.onCreate()
        isRunning = true
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("AI Call Gateway সার্ভার কানেক্ট হচ্ছে..."))

        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AIGateway::WakeLock").apply {
            acquire()
        }

        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        setupPhoneStateListener()
        audioBridge = CallAudioBridge(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverUrl = intent?.getStringExtra("SERVER_URL") ?: "https://your-domain.com"
        connectSocket(serverUrl)
        return START_STICKY
    }

    private fun connectSocket(serverUrl: String) {
        try {
            socket?.disconnect()
            val opts = IO.Options().apply {
                reconnection = true
                reconnectionDelay = 2000
            }
            socket = IO.socket(serverUrl, opts)

            socket?.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "Connected to AI Voice Server!")
                updateNotification("সার্ভারের সাথে কানেক্টেড ✅")

                val deviceInfo = JSONObject().apply {
                    put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("simSlot", 1)
                }
                socket?.emit("register_gateway", deviceInfo)
            }

            socket?.on("dial_call") { args ->
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val data = args[0] as JSONObject
                    val phone = data.getString("phone")
                    val name = data.optString("name", "সম্মানিত কাস্টমার")
                    val leadId = data.getString("leadId")
                    val openingSpeech = data.optString("openingSpeech", "আসসালামু আলাইকুম!")

                    handleIncomingDialRequest(leadId, phone, name, openingSpeech)
                }
            }

            socket?.on("ai_speech_reply") { args ->
                if (args.isNotEmpty() && args[0] is JSONObject) {
                    val data = args[0] as JSONObject
                    val replyText = data.getString("replyText")
                    audioBridge?.speakBengali(replyText)
                }
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.w(TAG, "Disconnected from AI Voice Server")
                updateNotification("সার্ভার থেকে বিচ্ছিন্ন (পুনরায় চেষ্টা চলছে...)")
            }

            socket?.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Socket init failed: ${e.message}")
        }
    }

    private fun handleIncomingDialRequest(leadId: String, phone: String, name: String, openingSpeech: String) {
        currentLeadId = leadId
        currentPhone = phone
        currentName = name

        Log.d(TAG, "Initiating Call to $phone ($name)")
        updateNotification("ডায়াল করা হচ্ছে: $name ($phone)...")

        val callIntent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:$phone")
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(callIntent)

        // Ready the audio bridge with initial opening speech once call connects
        audioBridge?.setInitialSpeech(openingSpeech)
    }

    private fun setupPhoneStateListener() {
        val listener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                super.onCallStateChanged(state, phoneNumber)
                when (state) {
                    TelephonyManager.CALL_STATE_OFFHOOK -> {
                        // Call answered / in progress
                        isCallActive = true
                        Log.d(TAG, "Call OFFHOOK - Customer Picked Up!")
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
                            Log.d(TAG, "Call Ended.")
                            audioBridge?.stopLiveConversation()

                            // Report call results
                            val result = JSONObject().apply {
                                put("leadId", currentLeadId)
                                put("phone", currentPhone)
                                put("leadName", currentName)
                                put("outcome", "completed")
                                put("durationSeconds", audioBridge?.getCallDurationSeconds() ?: 0)
                                put("transcript", audioBridge?.getFullTranscript() ?: "")
                            }
                            socket?.emit("call_finished", result)
                            updateNotification("সার্ভারের সাথে কানেক্টেড ✅")
                        }
                    }
                }
            }
        }
        telephonyManager.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AI Voice Calling Gateway",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AI Voice Call Gateway")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    override fun onDestroy() {
        isRunning = false
        wakeLock?.release()
        socket?.disconnect()
        audioBridge?.destroy()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
