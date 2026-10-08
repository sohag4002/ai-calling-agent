package com.aivoice.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var btnToggleService: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvLogs: TextView
    private lateinit var prefs: SharedPreferences

    companion object {
        private const val PERMISSION_REQUEST_CODE = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences("ai_gateway_prefs", Context.MODE_PRIVATE)

        etServerUrl = findViewById(R.id.etServerUrl)
        btnToggleService = findViewById(R.id.btnToggleService)
        tvStatus = findViewById(R.id.tvStatus)
        tvLogs = findViewById(R.id.tvLogs)

        val savedUrl = prefs.getString("server_url", "http://192.168.1.225:5050")
        etServerUrl.setText(savedUrl)

        checkPermissions()

        btnToggleService.setOnClickListener {
            val url = etServerUrl.text.toString().trim()
            if (url.isEmpty()) {
                Toast.makeText(this, "সার্ভার URL দিন!", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            prefs.edit().putString("server_url", url).apply()

            if (CallGatewayService.isRunning) {
                stopGatewayService()
            } else {
                startGatewayService(url)
            }
        }

        setupServiceCallbacks()
        updateUI()
    }

    private fun setupServiceCallbacks() {
        CallGatewayService.onLogListener = { msg ->
            runOnUiThread {
                val current = tvLogs.text.toString()
                tvLogs.text = "$msg\n$current"
            }
        }

        CallGatewayService.onStatusListener = { running, text ->
            runOnUiThread {
                updateUI(running, text)
            }
        }
    }

    private fun checkPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private fun startGatewayService(url: String) {
        try {
            val intent = Intent(this, CallGatewayService::class.java).apply {
                putExtra("SERVER_URL", url)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(intent)
            } else {
                startService(intent)
            }
            updateUI(true, "গেটওয়ে চালু হচ্ছে...")
        } catch (e: Exception) {
            Toast.makeText(this, "সার্ভিস চালু করা যায়নি: ${e.message}", Toast.LENGTH_LONG).show()
            tvLogs.text = "ত্রুটি: ${e.message}\n" + tvLogs.text
        }
    }

    private fun stopGatewayService() {
        try {
            val intent = Intent(this, CallGatewayService::class.java)
            stopService(intent)
            updateUI(false, "স্ট্যাটাস: বন্ধ ❌")
        } catch (e: Exception) {
            Toast.makeText(this, "সার্ভিস বন্ধ করা যায়নি: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    private fun updateUI(isRunning: Boolean = CallGatewayService.isRunning, statusText: String? = null) {
        if (isRunning) {
            tvStatus.text = statusText ?: "স্ট্যাটাস: সক্রিয় ও কানেক্টেড ✅"
            tvStatus.setTextColor(Color.parseColor("#10B981"))
            btnToggleService.text = "গেটওয়ে বন্ধ করুন"
            btnToggleService.setBackgroundColor(Color.parseColor("#EF4444"))
        } else {
            tvStatus.text = statusText ?: "স্ট্যাটাস: বন্ধ ❌"
            tvStatus.setTextColor(Color.parseColor("#F43F5E"))
            btnToggleService.text = "গেটওয়ে চালু করুন"
            btnToggleService.setBackgroundColor(Color.parseColor("#4F46E5"))
        }
    }

    override fun onResume() {
        super.onResume()
        setupServiceCallbacks()
        updateUI()
    }
}
