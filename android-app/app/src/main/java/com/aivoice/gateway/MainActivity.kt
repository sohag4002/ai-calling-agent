package com.aivoice.gateway

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
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

        etServerUrl.setText(prefs.getString("server_url", "https://your-domain.com"))

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

        updateUI()
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
        val intent = Intent(this, CallGatewayService::class.java).apply {
            putExtra("SERVER_URL", url)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        updateUI()
    }

    private fun stopGatewayService() {
        val intent = Intent(this, CallGatewayService::class.java)
        stopService(intent)
        updateUI()
    }

    private fun updateUI() {
        if (CallGatewayService.isRunning) {
            tvStatus.text = "স্ট্যাটাস: সক্রিয় ও কানেক্টেড ✅"
            tvStatus.setTextColor(getColor(android.R.color.holo_green_dark))
            btnToggleService.text = "গেটওয়ে বন্ধ করুন"
            btnToggleService.setBackgroundColor(getColor(android.R.color.holo_red_dark))
        } else {
            tvStatus.text = "স্ট্যাটাস: বন্ধ ❌"
            tvStatus.setTextColor(getColor(android.R.color.holo_red_dark))
            btnToggleService.text = "গেটওয়ে চালু করুন"
            btnToggleService.setBackgroundColor(getColor(android.R.color.holo_blue_dark))
        }
    }

    override fun onResume() {
        super.onResume()
        updateUI()
    }
}
