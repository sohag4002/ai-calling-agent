package com.aivoice.gateway

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

class CallAudioBridge(private val context: Context) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var isTtsReady = false
    private var initialSpeech: String? = null
    private var onSpeechResultListener: ((String) -> Unit)? = null

    private val transcriptBuilder = StringBuilder()
    private var callStartTime = 0L
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    companion object {
        private const val TAG = "CallAudioBridge"
    }

    init {
        tts = TextToSpeech(context, this)
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale("bn", "BD"))
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                // Fallback to standard Bengali
                tts?.setLanguage(Locale("bn"))
            }
            tts?.setSpeechRate(0.95f)
            tts?.setPitch(1.05f)
            isTtsReady = true
            Log.d(TAG, "Bengali TTS Engine Ready!")
        }
    }

    fun setInitialSpeech(text: String) {
        this.initialSpeech = text
    }

    fun startLiveConversation(onSpeechResult: (String) -> Unit) {
        this.onSpeechResultListener = onSpeechResult
        this.callStartTime = System.currentTimeMillis()
        transcriptBuilder.clear()

        // Switch call audio mode for bidirectional streaming
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true // Route call audio smoothly
        } catch (e: Exception) {
            Log.e(TAG, "Failed setting audio mode: ${e.message}")
        }

        // Delay 1.5 seconds after pickup then speak initial greeting
        Handler(Looper.getMainLooper()).postDelayed({
            initialSpeech?.let { speech ->
                speakBengali(speech)
            }
        }, 1500)
    }

    fun speakBengali(text: String) {
        if (!isTtsReady) {
            Log.w(TAG, "TTS not ready yet")
            return
        }

        transcriptBuilder.append("AI: ").append(text).append("\n")
        Log.d(TAG, "AI Speaking: $text")

        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "AI_SPEECH_UTTERANCE")

        // Wait until TTS completes speaking, then start listening to customer
        val estimatedSpeakingMs = (text.length * 80).coerceAtLeast(2000)
        Handler(Looper.getMainLooper()).postDelayed({
            startListening()
        }, estimatedSpeakingMs.toLong())
    }

    private fun startListening() {
        Handler(Looper.getMainLooper()).post {
            try {
                speechRecognizer?.destroy()
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "bn-BD")
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "bn-BD")
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }

                speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull() ?: ""
                        if (text.isNotEmpty()) {
                            transcriptBuilder.append("Customer: ").append(text).append("\n")
                            Log.d(TAG, "Recognized Bengali: $text")
                            onSpeechResultListener?.invoke(text)
                        } else {
                            // Retry listening
                            startListening()
                        }
                    }

                    override fun onError(error: Int) {
                        Log.d(TAG, "Speech recognition error code: $error")
                        // Listen again on silence/pause
                        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            Handler(Looper.getMainLooper()).postDelayed({ startListening() }, 500)
                        }
                    }

                    override fun onReadyForSpeech(params: Bundle?) {}
                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() {}
                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })

                speechRecognizer?.startListening(intent)
            } catch (e: Exception) {
                Log.e(TAG, "Start listening exception: ${e.message}")
            }
        }
    }

    fun stopLiveConversation() {
        speechRecognizer?.stopListening()
        speechRecognizer?.destroy()
        speechRecognizer = null
        tts?.stop()

        try {
            audioManager.mode = AudioManager.MODE_NORMAL
            audioManager.isSpeakerphoneOn = false
        } catch (e: Exception) {}
    }

    fun getCallDurationSeconds(): Int {
        if (callStartTime == 0L) return 0
        return ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
    }

    fun getFullTranscript(): String {
        return transcriptBuilder.toString()
    }

    fun destroy() {
        stopLiveConversation()
        tts?.shutdown()
    }
}
