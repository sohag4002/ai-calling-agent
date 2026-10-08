package com.aivoice.gateway

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
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
        initTtsEngine()
    }

    private fun initTtsEngine() {
        try {
            // Try Google TTS Engine first for superior Bengali voice support
            tts = TextToSpeech(context, this, "com.google.android.tts")
        } catch (e: Exception) {
            tts = TextToSpeech(context, this)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            try {
                val audioAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setLegacyStreamType(AudioManager.STREAM_VOICE_CALL)
                    .build()
                tts?.setAudioAttributes(audioAttributes)
            } catch (e: Exception) {
                Log.w(TAG, "AudioAttributes setup warning: ${e.message}")
            }

            val bnBd = Locale("bn", "BD")
            val bn = Locale("bn")
            var langResult = tts?.setLanguage(bnBd)
            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                langResult = tts?.setLanguage(bn)
            }

            if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                CallGatewayService.log("⚠️ ফোনে বাংলা TTS ভয়েস মিসিং। Google Speech Services প্রয়োজন।")
            } else {
                CallGatewayService.log("বাংলা ভয়েস (TTS) ইঞ্জিন প্রস্তুত! 🗣️")
            }

            tts?.setSpeechRate(0.95f)
            tts?.setPitch(1.0f)
            isTtsReady = true

            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    Log.d(TAG, "TTS Started speaking: $utteranceId")
                }

                override fun onDone(utteranceId: String?) {
                    Log.d(TAG, "TTS Finished speaking. Starting listener...")
                    Handler(Looper.getMainLooper()).postDelayed({
                        startListening()
                    }, 400)
                }

                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    Log.e(TAG, "TTS Error speaking: $utteranceId")
                    Handler(Looper.getMainLooper()).postDelayed({
                        startListening()
                    }, 500)
                }
            })
        } else {
            CallGatewayService.log("❌ TTS ইনিশিয়ালাইজেশন ব্যর্থ হয়েছে।")
        }
    }

    fun setInitialSpeech(text: String) {
        this.initialSpeech = text
    }

    fun startLiveConversation(onSpeechResult: (String) -> Unit) {
        this.onSpeechResultListener = onSpeechResult
        this.callStartTime = System.currentTimeMillis()
        transcriptBuilder.clear()

        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL)
            audioManager.setStreamVolume(AudioManager.STREAM_VOICE_CALL, maxVol, 0)
        } catch (e: Exception) {
            Log.e(TAG, "Failed setting audio mode: ${e.message}")
        }

        Handler(Looper.getMainLooper()).postDelayed({
            val speech = initialSpeech ?: "আসসালামু আলাইকুম! কেমন আছেন?"
            speakBengali(speech)
        }, 1200)
    }

    fun speakBengali(text: String) {
        if (text.isEmpty()) return

        transcriptBuilder.append("AI: ").append(text).append("\n")
        CallGatewayService.log("🤖 AI বলছে: $text")

        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
        } catch (e: Exception) {}

        if (!isTtsReady || tts == null) {
            initTtsEngine()
            Handler(Looper.getMainLooper()).postDelayed({
                val params = Bundle().apply {
                    putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_VOICE_CALL)
                }
                tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "AI_SPEECH_UTTERANCE")
            }, 800)
            return
        }

        val params = Bundle().apply {
            putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_VOICE_CALL)
            putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
        }

        val res = tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "AI_SPEECH_UTTERANCE")
        if (res == TextToSpeech.ERROR) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "AI_SPEECH_UTTERANCE")
        }
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
                            CallGatewayService.log("👤 কাস্টমার: $text")
                            onSpeechResultListener?.invoke(text)
                        } else {
                            startListening()
                        }
                    }

                    override fun onError(error: Int) {
                        Log.d(TAG, "Speech recognition error code: $error")
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
        try {
            speechRecognizer?.stopListening()
            speechRecognizer?.destroy()
            speechRecognizer = null
            tts?.stop()
        } catch (e: Exception) {}

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
        try {
            tts?.shutdown()
        } catch (e: Exception) {}
    }
}
