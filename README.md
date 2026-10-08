# AI Voice Calling & WhatsApp Auto-Caller Agent 🚀

An autonomous AI Voice Calling and WhatsApp Lead-to-Call Automation system designed for e-commerce, digital agencies, and service businesses.

## 🌟 Core Architecture

```
[ Customer sends WhatsApp Message ]
              ⬇️
[ WhatsApp Listener (Baileys Engine) ] ──> Captures Phone Number & Message
              ⬇️
[ AI Orchestrator (Groq / Gemini) ] ──> Generates Conversational Script
              ⬇️
[ Android Call Gateway (SIM / SIP) ] ──> Automatically Dials Customer's Phone
              ⬇️
[ Live Bengali Voice Conversation ] ──> "আসসালামু আলাইকুম! আপনি কি আমাদের সার্ভিসটি নিতে আগ্রহী?"
              ⬇️
[ Real-time Status & WhatsApp Summary ] ──> Admin Dashboard & WhatsApp Confirmation
```

## 📁 Project Structure

* **`backend/`**: Node.js + Express + WebSocket backend server ready for cPanel (Setup Node.js App) or VPS.
  * WhatsApp QR Code Scanner & Message Listener
  * Groq Llama-3 & Gemini Voice AI Brain
  * Live Webhook & Android Gateway Synchronizer
  * Modern Dark-Mode Glassmorphism Admin Dashboard
* **`android-app/`**: Full Android Call Gateway Application (Kotlin)
  * Dual-SIM & Single-SIM Auto-Dialing Service
  * Foreground Persistent Service (Works 24/7 in background)
  * Real-time WebSocket audio & call state bridge
* **`cpanel-setup/`**: cPanel deployment configs, `.htaccess`, and step-by-step guide.

---

## ⚡ Quick Start Guide

### 1. Backend Setup (cPanel / Local)
1. Navigate to `backend/`
2. Run `npm install`
3. Copy `.env.example` to `.env` and enter your Groq API Key (Free from https://console.groq.com)
4. Run `npm start`
5. Open `http://localhost:5000` (or your domain) to view the Admin Dashboard and scan WhatsApp QR Code.

### 2. Android Gateway Setup
1. Open the `android-app/` folder in Android Studio.
2. Build APK or install directly on your Android phone.
3. Open the app, enter your Server URL (e.g. `https://yourdomain.com`), and press **Connect**.
4. Keep the app running in the background.

---

Developed with ❤️ for high-conversion automated lead calling.
