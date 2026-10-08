package com.aivoice.gateway

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = context.getSharedPreferences("ai_gateway_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "http://192.168.1.225:5050") ?: "http://192.168.1.225:5050"
        val isServiceEnabled = prefs.getBoolean("service_enabled", true)

        if (isServiceEnabled) {
            val serviceIntent = Intent(context, CallGatewayService::class.java).apply {
                putExtra("SERVER_URL", serverUrl)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        }
    }
}
