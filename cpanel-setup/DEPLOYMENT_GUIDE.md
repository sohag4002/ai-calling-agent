# 🚀 cPanel Deployment & Setup Guide

এই সম্পূর্ণ গাইডটি অনুসরণ করে আপনি খুব সহজে **cPanel**-এ আপনার **AI Voice Calling & WhatsApp Auto-Caller** সার্ভার রান করতে পারবেন।

---

## 📁 ধাপ ১: ফাইল আপলোড করা
1. আপনার cPanel-এ লগইন করুন।
2. **File Manager**-এ যান।
3. একটি নতুন ফোল্ডার তৈরি করুন (যেমন: `caller-agent` বা আপনার সাবডোমেইনের রুট ফোল্ডার)।
4. আমাদের `ai-calling-agent/backend/` ফোল্ডারের সমস্ত ফাইল জিপ (`.zip`) করে সেখানে আপলোড করে **Extract** করুন।

---

## ⚙️ ধাপ ২: cPanel "Setup Node.js App" কনফিগারেশন
1. cPanel সার্চ বারে গিয়ে খুঁজুন **"Setup Node.js App"**।
2. **"Create Application"** বাটনে ক্লিক করুন।
3. নিচের তথ্যগুলো দিয়ে ফর্ম পূরণ করুন:
   - **Node.js Version:** `18.x` অথবা `20.x` (LTS সিলেক্ট করুন)
   - **Application Mode:** `Production`
   - **Application Root:** আপনার ফোল্ডারের নাম (যেমন: `caller-agent`)
   - **Application URL:** আপনার ডোমেইন বা সাবডোমেইন সিলেক্ট করুন (যেমন: `caller.yourdomain.com`)
   - **Application Startup File:** `server.js`
4. **"Create"** বাটনে ক্লিক করুন।

---

## 📦 ধাপ ৩: ডিপেনডেন্সি ইনস্টল ও রান করা
1. স্ক্রিনে উপরে একটি কমান্ড দেখতে পাবেন:
   ```bash
   source /home/username/nodevenv/caller-agent/18/bin/activate && cd /home/username/caller-agent
   ```
2. cPanel-এর **Terminal** অপশনে গিয়ে এই কমান্ডটি পেস্ট করে এন্টার দিন।
3. এরপর ডিপেনডেন্সি ইনস্টল করতে রান করুন:
   ```bash
   npm install
   ```
4. এরপর **"Setup Node.js App"** পেজে এসে **"Restart Application"** বাটনে ক্লিক করুন।

---

## 📱 ধাপ ৪: হোয়াটসঅ্যাপ ও অ্যান্ড্রয়েড অ্যাপ কানেক্ট করা

1. ব্রাউজারে আপনার ডোমেইনটি খুলুন (যেমন: `https://caller.yourdomain.com`)।
2. স্ক্রিনে একটি **WhatsApp QR Code** দেখতে পাবেন।
3. আপনার ফোনের WhatsApp থেকে **Linked Devices > Link a Device** দিয়ে QR কোডটি স্ক্যান করে কানেক্ট করুন।
4. এরপর আপনার অ্যান্ড্রয়েড ফোনে **AI Call Gateway APK** টি ওপেন করুন।
5. সার্ভার URL বক্সে আপনার ডোমেইন অ্যাড্রেস (`https://caller.yourdomain.com`) লিখে **"গেটওয়ে চালু করুন"** বাটনে চাপুন।

---

## 🎉 এখন কীভাবে টেস্ট করবেন?
- অন্য যেকোনো নম্বর থেকে আপনার কানেক্ট করা হোয়াটসঅ্যাপ নম্বরে একটি মেসেজ দিন (যেমন: *"হাই, আমি বিস্তারিত জানতে চাই"*)।
- ১০ সেকেন্ডের মধ্যে আপনার অ্যান্ড্রয়েড ফোন স্বয়ংক্রিয়ভাবে ওই নম্বরে কল ডায়াল করবে এবং মিষ্টি বাংলায় কথা বলা শুরু করবে!
