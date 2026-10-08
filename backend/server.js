require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const db = require('./database');
const aiService = require('./aiService');
const whatsappService = require('./whatsappService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Direct Image Upload for Hosting & Website Packages
app.post('/api/upload-catalog-image', (req, res) => {
  const { category, base64Data, extension } = req.body;
  if (!category || !base64Data) {
    return res.status(400).json({ error: 'Category and base64Data are required' });
  }

  try {
    const ext = extension || 'png';
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = `${category}_package_${Date.now()}.${ext}`;
    const filePath = path.join(uploadsDir, filename);
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

    const relativePath = `/uploads/${filename}`;
    const settings = db.getSettings();
    if (!settings.mediaCatalog) settings.mediaCatalog = {};

    if (category === 'hosting') {
      settings.mediaCatalog.hostingImageUrl = relativePath;
    } else if (category === 'website') {
      settings.mediaCatalog.websiteImageUrl = relativePath;
    }

    db.updateSettings({ mediaCatalog: settings.mediaCatalog });
    console.log(`📸 Direct Image Uploaded for ${category}: ${relativePath}`);

    res.json({
      success: true,
      imageUrl: relativePath,
      category,
      message: `${category === 'hosting' ? 'হোস্টিং' : 'ওয়েবসাইট'} প্যাকেজের ছবি সফলভাবে আপলোড হয়েছে!`
    });
  } catch (err) {
    console.error('Image Upload Error:', err);
    res.status(500).json({ error: 'Image upload failed: ' + err.message });
  }
});

// Set Socket.io in WhatsApp service
whatsappService.setSocketIO(io);

// Track connected Android Phone Gateways
let connectedGateways = new Map(); // socketId -> deviceInfo

// Auto-Call Callback triggered from WhatsApp message or intent
whatsappService.setOnNewLead(async (lead) => {
  if (connectedGateways.size === 0) {
    console.warn(`⚠️ Lead received for ${lead.phone}, but no Android Phone Gateway is currently connected.`);
    db.updateLeadStatus(lead.phone, 'no_gateway_connected');
    io.emit('lead_status_update', { phone: lead.phone, status: 'no_gateway_connected' });
    return;
  }

  // Pick first available connected Android Gateway
  const [gatewaySocketId, gatewayInfo] = connectedGateways.entries().next().value;
  const openingSpeech = await aiService.generateOpeningSpeech(lead);

  console.log(`🚀 Dispatching Call to Android Gateway (${gatewayInfo.deviceName}) for: ${lead.phone}`);
  db.updateLeadStatus(lead.phone, 'calling');
  io.emit('lead_status_update', { phone: lead.phone, status: 'calling' });

  io.to(gatewaySocketId).emit('dial_call', {
    leadId: lead.id,
    phone: lead.phone,
    name: lead.name,
    openingSpeech: openingSpeech
  });
});

// ─── Socket.IO Handler (Android App & Web Dashboard) ─────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send current state
  socket.emit('whatsapp_status', {
    status: whatsappService.connectionStatus,
    qr: whatsappService.qrCodeDataUrl
  });

  socket.emit('gateways_update', Array.from(connectedGateways.values()));

  // Android Gateway Registration
  const handleGatewayReg = (deviceData = {}) => {
    connectedGateways.set(socket.id, {
      socketId: socket.id,
      deviceName: deviceData.deviceName || 'Android SIM Phone',
      simSlot: deviceData.simSlot || 1,
      connectedAt: new Date().toISOString()
    });
    console.log(`📱 Android Gateway Registered: ${deviceData.deviceName || 'Android SIM Phone'} (Total: ${connectedGateways.size})`);
    io.emit('gateways_update', Array.from(connectedGateways.values()));
  };

  socket.on('register_gateway', handleGatewayReg);
  socket.on('register_android_gateway', handleGatewayReg);

  // Android Gateway Dialog Bridge (Live Voice Conversation)
  socket.on('process_speech', async (data) => {
    const { leadId, phone, userSpeech, conversationHistory } = data;
    const lead = db.getLeads().find(l => l.phone === phone) || { name: 'কাস্টমার', phone };
    
    console.log(`🗣️ Customer [${phone}] said: "${userSpeech}"`);
    const aiReply = await aiService.generateConversationReply(lead, conversationHistory || [], userSpeech);
    console.log(`🤖 AI replying: "${aiReply}"`);

    socket.emit('ai_speech_reply', {
      leadId,
      phone,
      replyText: aiReply
    });
  });

  // Android Call Finished Event
  socket.on('call_finished', async (callResult) => {
    console.log(`📞 Call finished for ${callResult.phone}. Outcome: ${callResult.outcome}`);

    // Analyze transcript
    const analysis = await aiService.analyzeCallTranscript(callResult.transcript || '');
    
    // Save call record
    const callRecord = db.addCallRecord({
      phone: callResult.phone,
      leadName: callResult.leadName,
      durationSeconds: callResult.durationSeconds || 0,
      outcome: callResult.outcome || 'completed',
      transcript: callResult.transcript || '',
      summary: analysis.summary,
      interestLevel: analysis.interestLevel
    });

    // Update lead status
    db.updateLeadStatus(callResult.phone, analysis.interestLevel, analysis.notes);

    io.emit('call_completed', callRecord);
    io.emit('lead_status_update', { phone: callResult.phone, status: analysis.interestLevel });
    io.emit('stats_update', db.getStats());

    // Send WhatsApp Post-Call Auto-Summary Receipt if configured
    const settings = db.getSettings();
    if (settings.postCallSummaryWhatsAppEnabled !== false && callResult.outcome === 'completed') {
      const summaryMsg = await aiService.generatePostCallSummaryMessage(
        { name: callResult.leadName, phone: callResult.phone },
        analysis.summary,
        analysis.interestLevel
      );
      await whatsappService.sendTextMessage(callResult.phone, summaryMsg);
      db.appendChatMessage(callResult.phone, 'assistant', summaryMsg);
      console.log(`📩 Sent WhatsApp Post-Call Summary Receipt to ${callResult.phone}`);
    }
  });

  socket.on('disconnect', () => {
    if (connectedGateways.has(socket.id)) {
      connectedGateways.delete(socket.id);
      console.log(`📱 Android Gateway disconnected. (Remaining: ${connectedGateways.size})`);
      io.emit('gateways_update', Array.from(connectedGateways.values()));
    }
  });
});

// ─── REST API Routes ──────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    whatsapp: {
      status: whatsappService.connectionStatus,
      qr: whatsappService.qrCodeDataUrl
    },
    gateways: Array.from(connectedGateways.values()),
    stats: db.getStats()
  });
});

app.get('/api/leads', (req, res) => {
  res.json(db.getLeads());
});

app.post('/api/leads/set-type', (req, res) => {
  const { phone, customerType } = req.body;
  if (!phone || !customerType) return res.status(400).json({ error: 'Phone and customerType are required' });
  const lead = db.setCustomerType(phone, customerType);
  io.emit('lead_updated', lead);
  res.json({ success: true, lead });
});

app.post('/api/leads/update-phone', (req, res) => {
  const { phone, realPhone, name } = req.body;
  if (!phone || !realPhone) {
    return res.status(400).json({ error: 'Phone and realPhone are required' });
  }
  const lead = db.updateLeadPhone(phone, realPhone, name);
  io.emit('lead_updated', lead);
  res.json({ success: true, lead });
});

app.get('/api/calls', (req, res) => {
  res.json(db.getCalls());
});

app.get('/api/orders', (req, res) => {
  res.json(db.getOrders());
});

app.post('/api/orders/update-status', (req, res) => {
  const { orderId, status } = req.body;
  const orders = db.getOrders();
  const ord = orders.find(o => o.id === orderId);
  if (ord) {
    ord.status = status;
    db.saveDb ? db.saveDb(db.getDb()) : null;
    io.emit('orders_updated', orders);
    return res.json({ success: true, order: ord });
  }
  res.status(404).json({ error: 'Order not found' });
});

app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings/toggle-auto-reply', (req, res) => {
  const { enabled } = req.body;
  const currentSettings = db.getSettings();
  const newStatus = typeof enabled === 'boolean' ? enabled : !currentSettings.whatsappAiReplyEnabled;
  const updated = db.updateSettings({ whatsappAiReplyEnabled: newStatus });
  io.emit('auto_reply_status_changed', { enabled: newStatus });
  res.json({ success: true, enabled: newStatus, settings: updated });
});

app.post('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  aiService.initGroq(); // Reload AI keys
  res.json({ success: true, settings: updated });
});

app.get('/api/chat/:phone', (req, res) => {
  const phone = req.params.phone;
  res.json({
    history: db.getChatHistory(phone),
    isAiPaused: db.isAiPausedForUser(phone)
  });
});

// Human Takeover: Send Manual Message from Dashboard
app.post('/api/chat/send-manual', async (req, res) => {
  const { phone, message, pauseMinutes } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'Phone and message are required' });
  }

  // Set Human Takeover (Pauses AI auto-reply for 30 minutes)
  db.setHumanTakeover(phone, pauseMinutes || 30);
  
  const sent = await whatsappService.sendTextMessage(phone, message);
  if (sent) {
    db.appendChatMessage(phone, 'human_agent', message);
    io.emit('chat_message', { phone, role: 'human_agent', text: message, name: '👤 আপনি (Human Agent)' });
    res.json({ success: true, message: 'Message sent by human agent & AI paused.' });
  } else {
    res.status(500).json({ error: 'Failed to send message. Is WhatsApp connected?' });
  }
});

// Toggle Human Takeover / Resume AI
app.post('/api/chat/toggle-ai-pause', (req, res) => {
  const { phone, pause } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  if (pause) {
    db.setHumanTakeover(phone, 60);
  } else {
    db.resumeAiForUser(phone);
  }

  res.json({ success: true, isAiPaused: db.isAiPausedForUser(phone) });
});

app.post('/api/leads/call', async (req, res) => {
  const { phone, name } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  if (connectedGateways.size === 0) {
    return res.status(400).json({ error: 'No Android Phone Gateway is currently connected. Please open the app on your phone.' });
  }

  const lead = {
    id: 'manual_' + Date.now(),
    name: name || 'সম্মানিত কাস্টমার',
    phone: phone,
    lastMessage: 'ম্যানুয়াল টেস্ট কল'
  };

  const [gatewaySocketId] = connectedGateways.entries().next().value;
  const openingSpeech = await aiService.generateOpeningSpeech(lead);

  io.to(gatewaySocketId).emit('dial_call', {
    leadId: lead.id,
    phone: lead.phone,
    name: lead.name,
    openingSpeech: openingSpeech
  });

  res.json({ success: true, message: `${phone} নম্বরে ডায়াল রিকোয়েস্ট পাঠানো হয়েছে!` });
});

app.post('/api/whatsapp/restart', async (req, res) => {
  try {
    await whatsappService.logout();
    await whatsappService.startSocket();
    res.json({ success: true, message: 'WhatsApp session restarted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/clear-session', async (req, res) => {
  try {
    await whatsappService.clearSession();
    res.json({ success: true, message: 'WhatsApp session auth cleared and socket restarted for fresh scan' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Server & WhatsApp Web Socket
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🤖 AI Voice Calling & WhatsApp Omnichannel Agent Running!`);
  console.log(`🔗 Dashboard: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
  
  // Start WhatsApp listener in background
  whatsappService.startSocket();
});
