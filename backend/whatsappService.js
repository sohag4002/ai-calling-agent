const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const axios = require('axios');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  makeCacheableSignalKeyStore, 
  DisconnectReason, 
  fetchLatestBaileysVersion, 
  downloadMediaMessage,
  extractMessageContent,
  Browsers,
  proto
} = require('@whiskeysockets/baileys');

const db = require('./database');
const aiService = require('./aiService');

// In-Memory & LRU Persistent Message Cache to eliminate "Waiting for this message"
const messageStore = new Map();
const msgRetryCounterCache = new NodeCache({
  stdTTL: 60 * 60 * 4, // 4 hours
  checkperiod: 120
});

// Idempotency cache to prevent double-replies
const processedMsgCache = new NodeCache({
  stdTTL: 600, // 10 minutes
  checkperiod: 60
});

// Load persistent message store if exists
const MSG_STORE_FILE = path.join(__dirname, 'msg_store.json');
try {
  if (fs.existsSync(MSG_STORE_FILE)) {
    const raw = fs.readFileSync(MSG_STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      messageStore.set(k, v);
    }
  }
} catch (e) {}

function saveMessageToStore(msgId, messageProto, remoteJid = '') {
  if (!msgId || !messageProto) return;
  messageStore.set(msgId, messageProto);
  if (remoteJid) {
    messageStore.set(`${remoteJid}_${msgId}`, messageProto);
  }
  if (messageStore.size > 5000) {
    const firstKey = messageStore.keys().next().value;
    messageStore.delete(firstKey);
  }
  // Throttled debounced save to disk
  if (!saveMessageToStore._timer) {
    saveMessageToStore._timer = setTimeout(() => {
      try {
        const obj = {};
        for (const [k, v] of messageStore.entries()) {
          obj[k] = v;
        }
        fs.writeFileSync(MSG_STORE_FILE, JSON.stringify(obj), 'utf8');
      } catch (err) {}
      saveMessageToStore._timer = null;
    }, 5000);
  }
}

function getRawMessageText(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  
  const content = extractMessageContent(m) || m;
  if (typeof content === 'string') return content;
  
  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.documentMessage?.caption) return content.documentMessage.caption;
  if (content.interactiveMessage?.body?.text) return content.interactiveMessage.body.text;
  if (content.interactiveResponseMessage?.body?.text) return content.interactiveResponseMessage.body.text;
  if (content.templateButtonReplyMessage?.selectedId) return content.templateButtonReplyMessage.selectedId;
  if (content.buttonsResponseMessage?.selectedButtonId) return content.buttonsResponseMessage.selectedButtonId;
  if (content.listResponseMessage?.singleSelectReply?.selectedRowId) return content.listResponseMessage.singleSelectReply.selectedRowId;
  if (content.listResponseMessage?.title) return content.listResponseMessage.title;

  // Handle edited messages
  if (content.protocolMessage?.editedMessage) {
    return getRawMessageText(content.protocolMessage.editedMessage);
  }
  if (content.editedMessage?.message) {
    return getRawMessageText(content.editedMessage.message);
  }

  // Handle ephemeral, view-once, and nested wrapper messages
  if (content.ephemeralMessage?.message) {
    return getRawMessageText(content.ephemeralMessage.message);
  }
  if (content.viewOnceMessage?.message) {
    return getRawMessageText(content.viewOnceMessage.message);
  }
  if (content.viewOnceMessageV2?.message) {
    return getRawMessageText(content.viewOnceMessageV2.message);
  }
  if (content.viewOnceMessageV2Extension?.message) {
    return getRawMessageText(content.viewOnceMessageV2Extension.message);
  }
  if (content.documentWithCaptionMessage?.message) {
    return getRawMessageText(content.documentWithCaptionMessage.message);
  }
  if (content.deviceSentMessage?.message) {
    return getRawMessageText(content.deviceSentMessage.message);
  }

  // Recursive fallback for nested object structures
  for (const key of Object.keys(content)) {
    if (content[key] && typeof content[key] === 'object' && key !== 'key' && key !== 'contextInfo') {
      const nested = getRawMessageText(content[key]);
      if (nested) return nested;
    }
  }

  return '';
}

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.qrCodeDataUrl = null;
    this.connectionStatus = 'disconnected'; // disconnected, waiting_for_qr_scan, connected
    this.io = null;
    this.onNewLeadCallback = null;
    this.signalKeyStore = null;
    
    // Anti-Ban & Human Emulation Queue System
    this.messageQueue = [];
    this.isProcessingQueue = false;
    this.recentUserMessages = new Map(); // phone -> { count, resetAt }
    this.isStarting = false;

    // Safe unhandled rejection logger
    process.on('unhandledRejection', (reason) => {
      const errStr = (reason?.stack || reason?.message || String(reason));
      if (!errStr.includes('Bad MAC') && !errStr.includes('Failed to decrypt message')) {
        console.warn('Unhandled Warning:', errStr.substring(0, 150));
      }
    });
  }

  setSocketIO(io) {
    this.io = io;
  }

  setOnNewLead(callback) {
    this.onNewLeadCallback = callback;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async sendTelegramAlert(text) {
    const settings = db.getSettings();
    if (settings.telegramNotificationEnabled && settings.telegramBotToken && settings.telegramChatId) {
      try {
        const url = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
        await axios.post(url, {
          chat_id: settings.telegramChatId,
          text: text,
          parse_mode: 'HTML'
        });
      } catch (err) {
        console.warn('Telegram Notification Error:', err.message);
      }
    }
  }

  async startSocket() {
    if (this.isStarting) return;
    this.isStarting = true;

    try {
      const authPath = path.join(__dirname, 'whatsapp-auth');
      if (!fs.existsSync(authPath)) {
        fs.mkdirSync(authPath, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authPath);
      const { version } = await fetchLatestBaileysVersion();

      // Clean up previous socket if existing
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
        } catch (e) {}
      }

      const customPino = pino({ level: 'warn' });
      this.signalKeyStore = makeCacheableSignalKeyStore(state.keys, customPino);

      this.sock = makeWASocket({
        version,
        logger: customPino,
        auth: {
          creds: state.creds,
          keys: this.signalKeyStore
        },
        msgRetryCounterCache,
        getMessage: async (key) => {
          if (key && key.id) {
            const fullKey = `${key.remoteJid || ''}_${key.id}`;
            const stored = messageStore.get(fullKey) || messageStore.get(key.id);
            if (stored) {
              try {
                return proto.Message.fromObject(stored);
              } catch (e) {
                return stored;
              }
            }
          }
          return undefined;
        },
        printQRInTerminal: false,
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: true
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
        if (jid && lid) {
          let cleanPhone = jid.replace('@s.whatsapp.net', '');
          if (cleanPhone.startsWith('880')) cleanPhone = '0' + cleanPhone.substring(3);
          console.log(`📱 Phone Number Shared by WhatsApp for ${lid}: ${cleanPhone}`);
          db.updateLeadPhone(lid.replace('@lid', ''), cleanPhone);
          if (this.io) {
            this.io.emit('lead_updated', { phone: lid.replace('@lid', ''), realPhone: cleanPhone });
          }
        }
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        this.isStarting = false;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr);
            this.connectionStatus = 'waiting_for_qr_scan';
            console.log('📲 WhatsApp QR Code generated. Scan from WhatsApp mobile!');
            if (this.io) {
              this.io.emit('whatsapp_qr', {
                qr: this.qrCodeDataUrl,
                status: this.connectionStatus
              });
            }
          } catch (err) {
            console.error('Failed to generate QR code data URL:', err);
          }
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.connectionStatus = 'disconnected';
          this.qrCodeDataUrl = null;
          console.log(`⚠️ WhatsApp Connection Closed (Code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
          
          if (this.io) {
            this.io.emit('whatsapp_status', { status: 'disconnected' });
          }
          if (shouldReconnect) {
            setTimeout(() => this.startSocket(), 5000);
          }
        } else if (connection === 'open') {
          this.connectionStatus = 'connected';
          this.qrCodeDataUrl = null;
          console.log('✅ WhatsApp Web Connected Successfully! (24/7 AI Auto-Responder Active)');
          if (this.io) {
            this.io.emit('whatsapp_status', { status: 'connected' });
          }
        }
      });

      // Listen for incoming message upserts
      this.sock.ev.on('messages.upsert', async (m) => {
        if (!m.messages || m.messages.length === 0) return;

        for (const msg of m.messages) {
          if (!msg || !msg.key) continue;

          const rawJid = msg.key.remoteJid || '';
          console.log(`📨 [UPSERT] fromMe: ${msg.key.fromMe}, JID: ${rawJid}, hasMessage: ${!!msg.message}, type: ${m.type}`);

          // Save to persistent message store for retry decryption
          if (msg.key.id && msg.message) {
            saveMessageToStore(msg.key.id, msg.message, msg.key.remoteJid);
          }

          // Identify if this is a self-chat test (e.g. Message to Myself)
          const myId = (this.sock?.user?.id || '').split(':')[0].replace(/[^0-9]/g, '');
          const myLid = (this.sock?.user?.lid || '').split(':')[0].replace(/[^0-9]/g, '');
          const cleanRaw = rawJid.split(':')[0].replace(/[^0-9]/g, '');
          
          const isSelfChat = msg.key.fromMe && (
            (myId && cleanRaw === myId) ||
            (myLid && cleanRaw === myLid) ||
            (myId && rawJid.includes(myId)) ||
            (myLid && rawJid.includes(myLid))
          );

          console.log(`🔎 [CHECK] fromMe: ${msg.key.fromMe}, isSelfChat: ${isSelfChat}, myId: ${myId}, myLid: ${myLid}, rawJid: ${rawJid}`);

          // Handle manual human outbound messages to external contacts
          if (msg.key.fromMe && !isSelfChat) {
            if (rawJid && !rawJid.endsWith('@g.us') && rawJid !== 'status@broadcast') {
              const msgId = msg.key.id;
              if (msgId && processedMsgCache.has(msgId)) {
                // Already processed and rendered via dashboard API
                continue;
              }
              if (msgId) {
                processedMsgCache.set(msgId, true);
              }

              const text = getRawMessageText(msg.message);
              if (text && text.trim().length > 0) {
                let pNum = rawJid.replace('@s.whatsapp.net', '').replace('@lid', '');
                if (pNum.startsWith('880')) pNum = '0' + pNum.substring(3);
                console.log(`📤 Outbound Manual Message by Phone to ${pNum}: "${text.trim()}"`);

                const savedHumanMsg = db.appendChatMessage(pNum, 'human_agent', text.trim());
                if (this.io) {
                  this.io.emit('chat_message', {
                    id: savedHumanMsg?.id,
                    phone: pNum,
                    role: 'human_agent',
                    text: text.trim(),
                    name: 'আপনি (ম্যানুয়াল চ্যাট)',
                    timestamp: savedHumanMsg?.timestamp || new Date().toISOString()
                  });
                }
              }
            }
            continue;
          }

          // Process incoming message (from customer or self-test)
          await this.handleIncomingWhatsAppMessage(msg);
        }
      });

      // Listen for decrypted message updates (Signal retry results)
      this.sock.ev.on('messages.update', async (updates) => {
        for (const update of updates) {
          const msgContent = update.update?.message || update.message;
          if (update && update.key && msgContent) {
            const msgObj = {
              key: update.key,
              message: msgContent,
              pushName: update.update?.pushName || update.pushName || ''
            };
            if (msgObj.key.id && msgObj.message) {
              saveMessageToStore(msgObj.key.id, msgObj.message, msgObj.key.remoteJid);
            }
            console.log(`🔄 [Signal Retry Decrypted] Processing updated message ${update.key.id}`);
            await this.handleIncomingWhatsAppMessage(msgObj);
          }
        }
      });

      // Listen for incoming WhatsApp Calls
      this.sock.ev.on('call', async (calls) => {
        if (!calls || !Array.isArray(calls)) return;
        for (const call of calls) {
          if (call.status === 'offer') {
            console.log(`📞 Incoming WhatsApp Call from ${call.from} (Call ID: ${call.id})`);
            
            // Reject call gracefully because WhatsApp Web protocol cannot stream 2-way WebRTC audio
            try {
              if (this.sock.rejectCall) {
                await this.sock.rejectCall(call.id, call.from);
              }
            } catch (rejErr) {
              console.warn('Call reject note:', rejErr.message);
            }

            const callerJid = call.from;
            let pNum = callerJid.replace('@s.whatsapp.net', '');
            if (pNum.startsWith('880')) pNum = '0' + pNum.substring(3);

            const settings = db.getSettings();
            const businessName = settings.businessName || 'Sohag Online';
            const callResponseText = `আসসালামু আলাইকুম! ${businessName}-এ আপনাকে স্বাগতম।

এই মুহূর্তে আমাদের লাইভ ভয়েস কলিং সাপোর্ট অটোমেটেড রয়েছে। আপনার যেকোনো তথ্য বা প্রশ্ন জানতে অনুগ্রহ করে এখানে সরাসরি একটি *ভয়েস মেসেজ (🎙️ Voice Note)* অথবা *টেক্সট* পাঠিয়ে দিন।

আমাদের AI কনসালট্যান্ট সঙ্গে সঙ্গে আপনার প্রশ্নের উত্তর দিয়ে সাহায্য করবে। ধন্যবাদ! 🙏`;

            try {
              await this.sock.sendMessage(callerJid, { text: callResponseText });
              db.appendChatMessage(pNum, 'assistant', callResponseText);
              if (this.io) {
                this.io.emit('chat_message', { phone: pNum, role: 'assistant', text: callResponseText, name: 'AI Assistant' });
              }
            } catch (err) {
              console.warn('Failed to send call rejection reply:', err.message);
            }

            // Record lead
            const callLead = db.addLead({
              name: 'WhatsApp Caller',
              phone: pNum,
              lastMessage: '📞 মিসড / ইনকামিং হোয়াটসঅ্যাপ কল'
            });
            if (this.io) {
              this.io.emit('new_lead', callLead);
            }
          }
        }
      });

    } catch (err) {
      console.error('Failed to start WhatsApp socket:', err);
      this.isStarting = false;
    }
  }

  async handleIncomingWhatsAppMessage(msg) {
    const rawJid = msg.key?.remoteJid;
    if (!rawJid) return;

    // Filter out status broadcasts, groups, and newsletters
    if (rawJid === 'status@broadcast' || rawJid.endsWith('@g.us') || rawJid.endsWith('@newsletter') || rawJid.endsWith('@broadcast')) {
      return;
    }

    // Filter out pure protocol/reaction messages with no content
    if (msg.message?.reactionMessage) return;
    if (msg.message?.protocolMessage) return;
    if (msg.message?.senderKeyDistributionMessage && Object.keys(msg.message).length === 1) return;
    if (msg.message?.messageContextInfo && Object.keys(msg.message).length === 1) return;

    const msgId = msg.key?.id;
    if (msgId && processedMsgCache.has(msgId)) {
      return; // Already enqueued and processed
    }
    if (msgId) {
      processedMsgCache.set(msgId, true);
    }

    // Immediately send Blue Tick (Read Receipt) to WhatsApp servers
    if (this.sock && this.sock.readMessages && msg.key) {
      try {
        await this.sock.readMessages([msg.key]);
      } catch (readErr) {
        console.warn('Read receipt note:', readErr?.message);
      }
    }

    // Check for direct phone number JID from WhatsApp senderPn / participantPn
    const senderPnJid = msg.key?.senderPn || msg.key?.participantPn;
    let realNumber = null;
    if (senderPnJid) {
      realNumber = senderPnJid.replace('@s.whatsapp.net', '').replace('@lid', '');
      if (realNumber.startsWith('880')) realNumber = '0' + realNumber.substring(3);
    }

    let phoneNumber = rawJid.replace('@s.whatsapp.net', '').replace('@lid', '');
    if (phoneNumber.startsWith('880')) {
      phoneNumber = '0' + phoneNumber.substring(3);
    } else if (!phoneNumber.startsWith('0') && phoneNumber.length === 10) {
      phoneNumber = '0' + phoneNumber;
    }

    if (realNumber) {
      console.log(`🔍 Extracted Real Phone Number from WhatsApp Protocol: ${realNumber} (LID: ${rawJid})`);
    }

    const pushName = msg.pushName || 'সম্মানিত কাস্টমার';
    let messageText = '';
    let isVoiceNote = false;
    let incomingImageBuffer = null;
    let incomingImageMime = 'image/jpeg';

    // 1. Check for Voice Note / Audio
    if (msg.message?.audioMessage) {
      isVoiceNote = true;
      console.log(`🎙️ Incoming Voice Note from ${pushName} (${phoneNumber}). Transcribing via Groq Whisper & Gemini Audio...`);
      try {
        const buffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: this.sock.updateMediaMessage }
        );
        const transcribed = await aiService.transcribeAudio(buffer, 'audio.ogg');
        if (transcribed && transcribed.trim().length > 0) {
          messageText = transcribed.trim();
          console.log(`📝 Audio Transcribed Successfully: "${transcribed}"`);
        } else {
          messageText = '[অস্পষ্ট বা না বোঝা ভয়েস মেসেজ]';
          console.log(`⚠️ Voice note could not be clearly transcribed.`);
        }
        db.getStats().totalVoiceNotes = (db.getStats().totalVoiceNotes || 0) + 1;
      } catch (audioErr) {
        console.error('Failed to download/transcribe audio:', audioErr.message);
        messageText = '[অস্পষ্ট বা না বোঝা ভয়েস মেসেজ]';
      }
    } else if (msg.message?.imageMessage) {
      // 2. Check for Image / Screenshot
      console.log(`🖼️ Incoming Image / Screenshot from ${pushName} (${phoneNumber}). Downloading for AI Vision analysis...`);
      try {
        incomingImageBuffer = await downloadMediaMessage(
          msg,
          'buffer',
          {},
          { logger: pino({ level: 'silent' }), reuploadRequest: this.sock.updateMediaMessage }
        );
        incomingImageMime = msg.message?.imageMessage?.mimetype || 'image/jpeg';
        const caption = msg.message?.imageMessage?.caption || '';
        messageText = `[📸 ছবি/স্ক্রিনশট পাঠানো হয়েছে] ${caption}`.trim();
      } catch (imgErr) {
        console.error('Failed to download image:', imgErr.message);
        messageText = msg.message?.imageMessage?.caption || '[📸 ছবি/স্ক্রিনশট]';
      }
    } else {
      // 3. Regular Text Message
      const rawText = getRawMessageText(msg.message);
      if (!rawText || rawText.trim().length === 0) {
        // Log for debugging if it's an unrecognized message structure
        if (msg.message && Object.keys(msg.message).length > 0) {
          console.log(`ℹ️ Non-text or protocol packet from ${phoneNumber}:`, Object.keys(msg.message));
        }
        return;
      }
      messageText = rawText.trim();
    }

    if (msgId) {
      processedMsgCache.set(msgId, true);
    }

    console.log(`📩 Incoming WhatsApp Message from ${pushName} (${phoneNumber}): "${messageText}"`);

    // Auto-extract real phone number from text if user types it
    const phoneRegex = /(?:\+?880|0)1[3-9]\d{8}/;
    const matchPhone = messageText.match(phoneRegex);
    let extractedPhone = matchPhone ? matchPhone[0] : null;
    if (extractedPhone && extractedPhone.startsWith('880')) {
      extractedPhone = '0' + extractedPhone.substring(3);
    }

    // Save Lead & Message history in DB
    const lead = db.addLead({
      name: pushName,
      phone: phoneNumber,
      lastMessage: messageText
    });

    if (realNumber) {
      db.updateLeadPhone(phoneNumber, realNumber);
      lead.realPhone = realNumber;
    } else if (extractedPhone) {
      db.updateLeadPhone(phoneNumber, extractedPhone);
      lead.realPhone = extractedPhone;
    }

    const userMeta = {
      isVoice: isVoiceNote,
      hasImage: !!incomingImageBuffer,
      imageMime: incomingImageMime,
      rawJid: rawJid
    };

    const savedUserMsg = db.appendChatMessage(phoneNumber, 'user', messageText, lead.realPhone, userMeta);

    if (this.io) {
      this.io.emit('new_lead', lead);
      this.io.emit('chat_message', {
        id: savedUserMsg?.id,
        phone: phoneNumber,
        role: 'user',
        text: messageText,
        name: pushName,
        meta: userMeta,
        timestamp: savedUserMsg?.timestamp || new Date().toISOString()
      });
      this.io.emit('live_stream_event', {
        type: 'inbound',
        phone: phoneNumber,
        name: pushName,
        text: messageText,
        isVoice: isVoiceNote,
        hasImage: !!incomingImageBuffer,
        timestamp: new Date().toISOString()
      });
      this.io.emit('stats_update', db.getStats());
    }

    // Add to Sequential Anti-Ban Human Queue
    this.enqueueMessage({
      msg,
      rawJid,
      phoneNumber,
      pushName,
      messageText,
      lead,
      isVoiceNote,
      imageBuffer: incomingImageBuffer,
      imageMime: incomingImageMime
    });
  }

  enqueueMessage(task) {
    this.messageQueue.push(task);
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const task = this.messageQueue.shift();
      try {
        await this.handleSingleCustomerMessage(task);
      } catch (err) {
        console.error('Error handling customer message in queue:', err);
      }

      // Safe pause between processing different customers
      const interCustomerPause = 1000 + Math.floor(Math.random() * 1500);
      await this.sleep(interCustomerPause);
    }

    this.isProcessingQueue = false;
  }

  async handleSingleCustomerMessage({ msg, rawJid, phoneNumber, pushName, messageText, lead, isVoiceNote, imageBuffer = null, imageMime = 'image/jpeg' }) {
    const settings = db.getSettings();

    // 1. Mark as read (Send Blue Ticks immediately)
    try {
      if (this.sock && this.sock.readMessages && msg.key) {
        await this.sock.readMessages([msg.key]);
      }
    } catch (e) {}

    // 2. Check if Human Takeover is active for this customer
    if (db.isAiPausedForUser(phoneNumber)) {
      console.log(`👤 Human Agent is active for ${phoneNumber}. AI auto-reply paused.`);
      return;
    }

    // 3. AI Auto-reply execution
    if (settings.whatsappAiReplyEnabled !== false && this.sock) {
      // Rate limiter per user (Anti-loop protection)
      const now = Date.now();
      const userHistoryCount = this.recentUserMessages.get(phoneNumber) || { count: 0, resetAt: now + 3600000 };
      if (now > userHistoryCount.resetAt) {
        userHistoryCount.count = 0;
        userHistoryCount.resetAt = now + 3600000;
      }
      userHistoryCount.count += 1;
      this.recentUserMessages.set(phoneNumber, userHistoryCount);

      if (userHistoryCount.count > 25) {
        console.warn(`⏳ Rate limit reached for ${phoneNumber}. Skipping automated reply.`);
        return;
      }

      // Send "typing..." presence
      try {
        await this.sock.sendPresenceUpdate('composing', rawJid);
      } catch (e) {}

      // Fetch conversation context and generate AI response + intent
      const history = db.getChatHistory(phoneNumber, lead.realPhone);
      const cleanUserText = messageText.replace('[🎙️ ভয়েস মেসেজ]: ', '').replace(/^"|"$/g, '');
      const aiResult = await aiService.generateWhatsAppReply(lead, history, cleanUserText, imageBuffer, imageMime);
      let replyText = aiResult.replyText;

      // Append Catalog link if requested
      if (aiResult.needsCatalog && settings.catalogPdfUrl) {
        replyText += `\n\n📄 বিস্তারিত ব্রোশিউর ও প্রাইস লিস্ট ডাউনলোড লিংক:\n${settings.catalogPdfUrl}`;
      }

      // Update Lead Temperature & Score
      db.updateLeadTemperature(phoneNumber, aiResult.temperature, aiResult.score);
      if (aiResult.customerPhone && !aiResult.customerPhone.includes('@lid')) {
        db.updateLeadPhone(phoneNumber, aiResult.customerPhone, aiResult.customerName || null);
      }
      if (this.io) {
        this.io.emit('lead_temperature_update', { phone: phoneNumber, temperature: aiResult.temperature, score: aiResult.score });
      }

      // Payment Screenshot Detected Alert & Order Update
      if (aiResult.isPaymentScreenshot) {
        console.log(`💰 Payment Screenshot Detected from ${pushName}: Amount: ${aiResult.paymentAmount}, TrxID: ${aiResult.trxId}`);
        const paymentOrder = db.addOrder({
          phone: aiResult.customerPhone || phoneNumber,
          name: aiResult.customerName || pushName,
          item: aiResult.packageItem || 'পেমেন্ট ভেরিফিকেশন',
          amount: aiResult.paymentAmount || 0,
          notes: `পেমেন্ট স্ক্রিনশট রিসিভড (TrxID: ${aiResult.trxId || 'N/A'})`
        });
        if (this.io) {
          this.io.emit('new_order', paymentOrder);
        }
        await this.sendTelegramAlert(`<b>💰 নতুন পেমেন্ট স্ক্রিনশট এসেছে!</b>\n\n👤 কাস্টমার: ${pushName}\n📱 ফোন: ${phoneNumber}\n💵 পরিমাণ: ৳${aiResult.paymentAmount || 'N/A'}\n🔖 TrxID: ${aiResult.trxId || 'N/A'}\n<i>অনুগ্রহ করে হিউম্যান এজেন্ট ভেরিফাই করুন।</i>`);
      }

      // Auto-Order Extraction & Alert
      if (aiResult.orderData) {
        const order = db.addOrder({
          phone: aiResult.orderData.phone || phoneNumber,
          name: aiResult.orderData.name || pushName,
          email: aiResult.orderData.email || '-',
          pageName: aiResult.orderData.pageName || '-',
          item: aiResult.orderData.item,
          amount: aiResult.orderData.amount,
          notes: `WhatsApp চ্যাট থেকে স্বয়ংক্রিয় অর্ডার নেওয়া হয়েছে`
        });
        console.log(`📦 New Order Auto-Created for ${order.name}:`, order);
        if (this.io) {
          this.io.emit('new_order', order);
        }
        await this.sendTelegramAlert(`<b>🎉 নতুন অর্ডার কনফার্ম হয়েছে!</b>\n\n👤 কাস্টমার: ${order.name}\n📱 ফোন: ${order.phone}\n📧 ইমেইল: ${order.email}\n🌐 পেজ: ${order.pageName}\n📦 প্যাকেজ: ${order.item}`);
      }

      // Realistic snappy typing simulation (1.2s - 2.8s)
      const simulatedTypingMs = Math.min(2800, Math.max(1200, (replyText.length * 15) + Math.floor(Math.random() * 500)));
      await this.sleep(simulatedTypingMs);

      // 7. Send the AI response (Image with Caption or Plain Text)
      try {
        const targetJid = rawJid;
        console.log(`📤 Sending WhatsApp response to: ${targetJid} (Customer: ${pushName})`);

        let imageToSend = null;
        if (aiResult.imageCategory === 'hosting' && settings.mediaCatalog?.hostingImageUrl) {
          imageToSend = settings.mediaCatalog.hostingImageUrl;
        } else if (aiResult.imageCategory === 'website' && settings.mediaCatalog?.websiteImageUrl) {
          imageToSend = settings.mediaCatalog.websiteImageUrl;
        }

        let sentMsg = null;
        if (imageToSend) {
          console.log(`🖼️ Sending ${aiResult.imageCategory} package image to ${pushName} (${phoneNumber})...`);
          if (imageToSend.startsWith('http://') || imageToSend.startsWith('https://')) {
            sentMsg = await this.sock.sendMessage(targetJid, { image: { url: imageToSend }, caption: replyText });
          } else {
            const localPath = path.isAbsolute(imageToSend) ? imageToSend : path.join(__dirname, 'public', imageToSend);
            if (fs.existsSync(localPath)) {
              const imgBuffer = fs.readFileSync(localPath);
              sentMsg = await this.sock.sendMessage(targetJid, { image: imgBuffer, caption: replyText });
            } else {
              sentMsg = await this.sock.sendMessage(targetJid, { text: replyText });
            }
          }
        } else {
          sentMsg = await this.sock.sendMessage(targetJid, { text: replyText });
        }

        if (sentMsg?.key?.id) {
          processedMsgCache.set(sentMsg.key.id, true);
          if (sentMsg.message) {
            saveMessageToStore(sentMsg.key.id, sentMsg.message, sentMsg.key.remoteJid);
          }
        }

        console.log(`🤖 AI Auto-Replied to ${pushName} (${phoneNumber}): "${replyText}"`);

        const aiMeta = {
          model: aiResult.modelUsed || 'Google Gemini 3.5 Flash',
          intent: aiResult.intent || 'সাধারণ তথ্য প্রদান',
          temperature: aiResult.temperature || 'warm',
          score: aiResult.score || 65,
          hasImage: !!imageToSend,
          imageCategory: aiResult.imageCategory || null,
          imageUrl: imageToSend || null,
          wantsCall: aiResult.wantsCall || false,
          isOrderConfirmed: !!aiResult.orderData,
          isPaymentScreenshot: !!aiResult.isPaymentScreenshot,
          paymentAmount: aiResult.paymentAmount || null,
          trxId: aiResult.trxId || null
        };

        const savedAiMsg = db.appendChatMessage(
          phoneNumber,
          'assistant',
          replyText + (imageToSend ? `\n[📸 ${aiResult.imageCategory} প্যাকেজ ইমেজ পাঠানো হয়েছে]` : ''),
          lead.realPhone,
          aiMeta
        );

        if (this.io) {
          this.io.emit('chat_message', {
            id: savedAiMsg?.id,
            phone: phoneNumber,
            role: 'assistant',
            text: replyText,
            name: settings.agentName || 'সাদিয়া (AI)',
            meta: aiMeta,
            timestamp: savedAiMsg?.timestamp || new Date().toISOString()
          });
          this.io.emit('live_stream_event', {
            type: 'ai_reply',
            phone: phoneNumber,
            name: settings.agentName || 'সাদিয়া (AI)',
            text: replyText,
            meta: aiMeta,
            timestamp: new Date().toISOString()
          });
          this.io.emit('stats_update', db.getStats());
        }
      } catch (sendErr) {
        console.error(`Failed to send WhatsApp reply to ${phoneNumber}:`, sendErr.message);
      }

      try {
        await this.sock.sendPresenceUpdate('paused', rawJid);
      } catch (e) {}

      // Customer Support Issue Notification
      if (aiResult.isSupportIssue) {
        console.log(`🚨 Customer Support Issue from ${pushName} (${phoneNumber}): "${messageText}"`);
        await this.sendTelegramAlert(`<b>🚨 কাস্টমার সাপোর্ট / অভিযোগ অ্যালার্ট!</b>\n\n👤 কাস্টমার: ${pushName} (${phoneNumber})\n🛠️ সমস্যা: ${messageText}\n<i>⚠️ টেকনিক্যাল টিম অনুগ্রহ করে যোগাযোগ করুন।</i>`);
      }

      // Hot Lead Alert to Telegram
      if (aiResult.temperature === 'hot' && !aiResult.orderData && !aiResult.isSupportIssue) {
        await this.sendTelegramAlert(`<b>🔥 হট লিড (Hot Lead Alert)!</b>\n\n👤 কাস্টমার: ${pushName} (${phoneNumber})\n💬 মেসেজ: ${messageText}\n📊 স্কোর: ${aiResult.score}/100`);
      }

      // Check if user wants a phone call
      if (aiResult.wantsCall && settings.autoCallEnabled && this.onNewLeadCallback) {
        const callDelay = (settings.autoCallDelaySeconds || 10) * 1000;
        console.log(`📞 Customer requested call. Scheduling voice call to ${phoneNumber} in ${settings.autoCallDelaySeconds}s...`);
        setTimeout(() => {
          this.onNewLeadCallback(lead);
        }, callDelay);
      }
    }
  }

  async sendTextMessage(phoneNumber, text) {
    if (!this.sock || this.connectionStatus !== 'connected') {
      return false;
    }

    let jid = String(phoneNumber || '').trim();
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid') && !jid.endsWith('@g.us')) {
      let digits = jid.replace(/[^0-9]/g, '');
      if (digits.startsWith('01') && digits.length === 11) {
        jid = `880${digits.substring(1)}@s.whatsapp.net`;
      } else if (digits.startsWith('8801') && digits.length === 13) {
        jid = `${digits}@s.whatsapp.net`;
      } else if (digits.length > 13) {
        jid = `${digits}@lid`;
      } else {
        jid = `${digits}@s.whatsapp.net`;
      }
    }

    try {
      const sent = await this.sock.sendMessage(jid, { text });
      if (sent?.key?.id) {
        processedMsgCache.set(sent.key.id, true);
        if (sent?.message) {
          saveMessageToStore(sent.key.id, sent.message, sent.key.remoteJid);
        }
      }
      return true;
    } catch (err) {
      console.error('Failed to send WhatsApp text message:', err.message);
      return false;
    }
  }

  async logout() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {}
      this.connectionStatus = 'disconnected';
      this.qrCodeDataUrl = null;
    }
  }

  async clearSession() {
    this.connectionStatus = 'disconnected';
    this.qrCodeDataUrl = null;
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners();
        await this.sock.logout();
      } catch (e) {}
      this.sock = null;
    }
    const authPath = path.join(__dirname, 'whatsapp-auth');
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('🧹 WhatsApp session auth files cleared.');
      } catch (e) {
        console.error('Failed to delete auth path:', e.message);
      }
    }
    this.isStarting = false;
    await this.startSocket();
    return true;
  }
}

module.exports = new WhatsAppService();
