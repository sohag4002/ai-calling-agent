const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

const defaultData = {
  settings: {
    businessName: 'Sohag Online',
    agentName: 'সাদিয়া',
    agentGender: 'female',
    serviceDescription: 'ল্যান্ডিং পেজ, কমপ্লিট ই-কমার্স ওয়েবসাইট, ফেসবুক বুস্টিং এবং ডিজিটাল সার্ভিস',
    whatsappAiReplyEnabled: true,
    humanTypingDelay: true,
    voiceNoteTranscribeEnabled: true,
    autoCallEnabled: false,
    autoCallDelaySeconds: 15,
    postCallSummaryWhatsAppEnabled: true,
    telegramNotificationEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
    catalogPdfUrl: '',
    workingHoursStart: '00:00', // 24/7
    workingHoursEnd: '23:59',
    followUpWhatsAppEnabled: true,
    followUpTemplate: 'ধন্যবাদ {name} ভাই! আমাদের সাথে কথা বলার জন্য। আপনার সার্ভিস সংক্রান্ত বিস্তারিত আমরা খুব শীঘ্রই পাঠিয়ে দিচ্ছি।',
    aiProvider: 'gemini', // 'gemini' or 'groq' or 'auto'
    groqApiKey: process.env.GROQ_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    mediaCatalog: {
      hostingImageUrl: '', // e.g. https://... or /uploads/hosting.jpg
      websiteImageUrl: '', // e.g. https://... or /uploads/website.jpg
      generalBrochureUrl: ''
    },
    websiteUrl: '',
    knowledgeBase: `১. ল্যান্ডিং পেজ সার্ভিস (Landing Page):
- ওয়ার্ডপ্রেস ল্যান্ডিং পেজ: মূল্য ৩,৫০০ টাকা (৩ দিনে ডেলিভারি, রেস্পন্সিভ ডিজাইন, ফেসবুক পিক্সেল সেটআপ)।
- কাস্টম কোডিং ল্যান্ডিং পেজ: মূল্য ৬,৫০০ টাকা (সুপার ফাস্ট স্পিড, প্রিমিয়াম এনিমেশন ও ফুল সিকিউরিটি)।

২. ই-কমার্স ওয়েবসাইট (E-Commerce):
- ওয়ার্ডপ্রেস / উকমার্স: ১০,০০০ - ১৫,০০০ টাকা (বিকাশ/নগদ পেমেন্ট গেটওয়ে, প্রোডাক্ট আপলোড)।
- কাস্টম ফুল-স্ট্যাক ওয়েবসাইট: ২৫,০০০+ টাকা।

৩. ডোমেইন ও হোস্টিং:
- প্রিমিয়াম সিপ্যানেল হোস্টিং (NVMe SSD): ১ বছর ২,৫০০ টাকা থেকে শুরু।`,
    systemPrompt: `তুমি একজন অত্যন্ত বিনয়ী, পেশাদার এবং আন্তরিক কাস্টমার সার্ভিস ও সেলস রিপ্রেজেন্টেটিভ। তোমার নাম {agentName} এবং তুমি {businessName} এর পক্ষ থেকে কথা বলছো।
তোমার প্রধান লক্ষ্য:
১. কাস্টমার এইমাত্র আমাদের হোয়াটসঅ্যাপে মেসেজ দিয়েছে, তাই তাকে আন্তরিক শুভেচ্ছা জানানো।
২. কাস্টমার আমাদের {serviceDescription} নিতে আগ্রহী কিনা তা জানা।
৩. কাস্টমার কী ধরনের কাজ করাতে চান তা সংক্ষেপে জেনে নেওয়া।
৪. কাস্টমার যদি রাজি হয়, তাহলে তার সুবিধাজনক সময় ও বিস্তারিত নোট করা।
কথোপকথনটি অত্যন্ত সাবলীল এবং মিষ্টি প্রমিত বাংলা উচ্চারণে সংক্ষিপ্ত বাক্যে পরিচালনা করবে। কোনো অপ্রাসঙ্গিক লম্বা কথা বলবে না।`,
    whatsappChatPrompt: `তুমি একজন বন্ধুত্বপূর্ণ, দ্রুত উত্তরদানকারী এবং পেশাদার কাস্টমার কেয়ার প্রতিনিধি। তোমার নাম {agentName} এবং তুমি {businessName} ({serviceDescription}) এর হয়ে হোয়াটসঅ্যাপে চ্যাট করছো।

নির্দেশনা:
১. কোনো কৃত্রিম বা রোবোটিক ভাব রাখা যাবে না। সাধারণ মানুষ যেভাবে হোয়াটসঅ্যাপে চ্যাট করে, ঠিক সেভাবে উত্তর দাও।
২. উত্তর হবে সংক্ষিপ্ত, স্পষ্ট এবং সহজ-সরল বাংলায় (সর্বোচ্চ ১-৩ বাক্য)।
৩. কাস্টমারের প্রশ্নের সরাসরি সমাধান দাও।
৪. কাস্টমার যদি ফোনে কথা বলতে চায় বা কল দেওয়ার কথা বলে, তবে তাকে বলবে যে আমাদের প্রতিনিধি শীঘ্রই তাকে ফোনে কল দিবে।
৫. কাস্টমার যদি অর্ডার বা প্যাকেজ কনফার্ম করে, তবে তার নাম, ফোন ও ঠিকানা চেয়ে নাও।`
  },
  leads: [],
  calls: [],
  orders: [], // [{ id, phone, name, item, amount, address, status, timestamp }]
  takeovers: {}, // phone -> { pausedUntil: timestamp, reason: 'manual_chat' }
  chatHistories: {}, // phone -> [{ role: 'user'|'assistant'|'human_agent', text: '...', time: '...' }]
  stats: {
    totalMessages: 0,
    totalAiReplies: 0,
    totalVoiceNotes: 0,
    totalCalls: 0,
    successfulCalls: 0,
    hotLeads: 0,
    totalOrders: 0
  }
};

function initDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

function getDb() {
  initDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return defaultData;
  }
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  getSettings: () => getDb().settings,
  updateSettings: (newSettings) => {
    const db = getDb();
    db.settings = { ...db.settings, ...newSettings };
    saveDb(db);
    return db.settings;
  },
  getLeads: () => getDb().leads || [],
  addLead: (lead) => {
    const db = getDb();
    const existing = db.leads.find(l => l.phone === lead.phone);
    if (existing) {
      existing.lastMessage = lead.lastMessage;
      existing.updatedAt = new Date().toISOString();
      existing.messageCount = (existing.messageCount || 1) + 1;
      if (lead.temperature) existing.temperature = lead.temperature;
    } else {
      db.leads.unshift({
        id: 'lead_' + Date.now(),
        name: lead.name || 'সম্মানিত কাস্টমার',
        phone: lead.phone,
        lastMessage: lead.lastMessage,
        temperature: lead.temperature || 'warm', // hot, warm, cold
        score: lead.score || 50,
        status: 'pending_call', // pending_call, calling, interested, not_interested, no_answer
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 1
      });
    }
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;
    saveDb(db);
    return existing || db.leads[0];
  },
  updateLeadTemperature: (phone, temperature, score = 50) => {
    const db = getDb();
    const lead = db.leads.find(l => l.phone === phone);
    if (lead) {
      lead.temperature = temperature;
      lead.score = score;
      lead.updatedAt = new Date().toISOString();
      if (temperature === 'hot') {
        db.stats.hotLeads = db.leads.filter(l => l.temperature === 'hot').length;
      }
      saveDb(db);
    }
    return lead;
  },
  updateLeadPhone: (oldPhoneOrId, realPhone, newName = null) => {
    const db = getDb();
    const lead = db.leads.find(l => l.phone === oldPhoneOrId || l.id === oldPhoneOrId);
    if (lead) {
      lead.realPhone = realPhone;
      if (newName) lead.name = newName;
      lead.updatedAt = new Date().toISOString();
      saveDb(db);
    }
    return lead;
  },
  setCustomerType: (phone, type) => {
    const db = getDb();
    const lead = db.leads.find(l => l.phone === phone || l.realPhone === phone);
    if (lead) {
      lead.customerType = type; // 'new_lead' | 'existing_customer' | 'vip'
      lead.updatedAt = new Date().toISOString();
      saveDb(db);
    }
    return lead;
  },
  isExistingCustomer: (phone, realPhone = null) => {
    const db = getDb();
    const orders = db.orders || [];
    const hasOrder = orders.some(o => o.phone === phone || (realPhone && o.phone === realPhone));
    const lead = (db.leads || []).find(l => l.phone === phone || (realPhone && l.realPhone === realPhone));
    const history = (db.chatHistories && (db.chatHistories[phone] || (realPhone && db.chatHistories[realPhone]))) || [];
    
    // If tagged as existing, or has placed an order, or has prior chat history >= 2 messages
    if (lead?.customerType === 'existing_customer' || lead?.customerType === 'vip' || hasOrder || history.length >= 2) {
      return true;
    }
    return false;
  },
  updateLeadStatus: (phone, status, notes = '') => {
    const db = getDb();
    const lead = db.leads.find(l => l.phone === phone);
    if (lead) {
      lead.status = status;
      if (notes) lead.notes = notes;
      lead.updatedAt = new Date().toISOString();
      saveDb(db);
    }
    return lead;
  },
  getCalls: () => getDb().calls || [],
  addCallRecord: (call) => {
    const db = getDb();
    const record = {
      id: 'call_' + Date.now(),
      phone: call.phone,
      leadName: call.leadName || 'সম্মানিত কাস্টমার',
      durationSeconds: call.durationSeconds || 0,
      outcome: call.outcome || 'completed', // completed, busy, no_answer, rejected
      transcript: call.transcript || '',
      summary: call.summary || '',
      interestLevel: call.interestLevel || 'unknown', // high, medium, low, not_interested
      timestamp: new Date().toISOString()
    };
    db.calls.unshift(record);
    db.stats.totalCalls = (db.stats.totalCalls || 0) + 1;
    if (call.outcome === 'completed') {
      db.stats.successfulCalls = (db.stats.successfulCalls || 0) + 1;
    }
    saveDb(db);
    return record;
  },
  getStats: () => getDb().stats || defaultData.stats,
  getChatHistory: (phone, realPhone = null) => {
    const db = getDb();
    if (!db.chatHistories) return [];
    
    // Collect all possible key aliases for this contact
    const possibleKeys = new Set([phone]);
    if (realPhone) possibleKeys.add(realPhone);
    if (phone && phone.includes('@lid')) possibleKeys.add(phone.replace('@lid', ''));
    if (phone && !phone.includes('@lid')) possibleKeys.add(`${phone}@lid`);
    if (realPhone && !realPhone.includes('@lid')) possibleKeys.add(`${realPhone}@lid`);

    // Check leads for linked phone/realPhone
    const linkedLead = (db.leads || []).find(l => possibleKeys.has(l.phone) || (l.realPhone && possibleKeys.has(l.realPhone)));
    if (linkedLead) {
      if (linkedLead.phone) possibleKeys.add(linkedLead.phone);
      if (linkedLead.realPhone) possibleKeys.add(linkedLead.realPhone);
    }

    let all = [];
    for (const k of possibleKeys) {
      if (k && db.chatHistories[k]) {
        all.push(...db.chatHistories[k]);
      }
    }

    if (all.length === 0) return [];

    // Merge and deduplicate by role + text + time window (5 seconds)
    all.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    const unique = [];
    for (const item of all) {
      const isDuplicate = unique.some(existing => {
        if (existing.id && item.id && existing.id === item.id) return true;
        const timeDiff = Math.abs(new Date(existing.timestamp || 0) - new Date(item.timestamp || 0));
        return existing.role === item.role && existing.text?.trim() === item.text?.trim() && timeDiff < 8000;
      });
      if (!isDuplicate) {
        unique.push(item);
      }
    }
    return unique.slice(-50);
  },
  appendChatMessage: (phone, role, text, realPhone = null, meta = {}) => {
    if (!phone || phone === 'undefined') return null;
    const db = getDb();
    if (!db.chatHistories) db.chatHistories = {};
    if (!db.chatHistories[phone]) db.chatHistories[phone] = [];
    
    const existingList = db.chatHistories[phone];
    // Prevent duplicate appending if last message has same role and text within 8 seconds
    const lastMsg = existingList[existingList.length - 1];
    if (lastMsg && lastMsg.role === role && lastMsg.text?.trim() === text?.trim() && (Date.now() - new Date(lastMsg.timestamp || 0).getTime()) < 8000) {
      return lastMsg;
    }

    const item = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      role, // 'user' | 'assistant' | 'human_agent'
      text: text?.trim() || '',
      timestamp: new Date().toISOString(),
      meta: meta || {}
    };

    db.chatHistories[phone].push(item);
    if (db.chatHistories[phone].length > 50) {
      db.chatHistories[phone] = db.chatHistories[phone].slice(-50);
    }

    // Sync to realPhone key as well if available
    if (realPhone && realPhone !== phone && realPhone !== 'undefined') {
      if (!db.chatHistories[realPhone]) db.chatHistories[realPhone] = [];
      const realList = db.chatHistories[realPhone];
      const lastReal = realList[realList.length - 1];
      if (!lastReal || lastReal.role !== role || lastReal.text?.trim() !== text?.trim() || (Date.now() - new Date(lastReal.timestamp || 0).getTime()) >= 8000) {
        db.chatHistories[realPhone].push(item);
        if (db.chatHistories[realPhone].length > 50) {
          db.chatHistories[realPhone] = db.chatHistories[realPhone].slice(-50);
        }
      }
    }

    if (role === 'assistant') {
      db.stats.totalAiReplies = (db.stats.totalAiReplies || 0) + 1;
    }

    saveDb(db);
    return item;
  },
  getAllConversations: () => {
    const db = getDb();
    const leads = db.leads || [];
    const chatHistories = db.chatHistories || {};
    const takeovers = db.takeovers || {};

    // Group keys by canonical customer identity
    const canonicalGroups = new Map(); // canonicalKey -> { primaryPhone, realPhone, keys: Set, lead }

    const registerKey = (key) => {
      if (!key || key === 'undefined') return;
      const cleanKey = key.replace('@lid', '');
      
      // Find matching lead
      const matchedLead = leads.find(l => 
        l.phone === key || l.phone === cleanKey || l.phone === `${cleanKey}@lid` ||
        (l.realPhone && (l.realPhone === key || l.realPhone === cleanKey))
      );

      const canonicalKey = matchedLead?.realPhone || matchedLead?.phone || cleanKey;
      if (!canonicalGroups.has(canonicalKey)) {
        canonicalGroups.set(canonicalKey, {
          primaryPhone: matchedLead?.phone || key,
          realPhone: matchedLead?.realPhone || (cleanKey.startsWith('01') ? cleanKey : null),
          keys: new Set([key, cleanKey]),
          lead: matchedLead
        });
      } else {
        const grp = canonicalGroups.get(canonicalKey);
        grp.keys.add(key);
        grp.keys.add(cleanKey);
        if (matchedLead && !grp.lead) grp.lead = matchedLead;
        if (matchedLead?.realPhone) grp.realPhone = matchedLead.realPhone;
      }
    };

    leads.forEach(l => {
      registerKey(l.phone);
      if (l.realPhone) registerKey(l.realPhone);
    });

    Object.keys(chatHistories).forEach(k => {
      if (k && k !== 'undefined') registerKey(k);
    });

    const conversations = [];
    for (const [canonicalKey, grp] of canonicalGroups.entries()) {
      const lead = grp.lead;
      
      // Collect and deduplicate all messages across this contact's keys
      let allMessages = [];
      for (const k of grp.keys) {
        if (chatHistories[k]) {
          allMessages.push(...chatHistories[k]);
        }
      }

      allMessages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
      const uniqueMessages = [];
      for (const item of allMessages) {
        const isDuplicate = uniqueMessages.some(existing => {
          if (existing.id && item.id && existing.id === item.id) return true;
          const timeDiff = Math.abs(new Date(existing.timestamp || 0) - new Date(item.timestamp || 0));
          return existing.role === item.role && existing.text?.trim() === item.text?.trim() && timeDiff < 8000;
        });
        if (!isDuplicate) {
          uniqueMessages.push(item);
        }
      }

      const lastMsg = uniqueMessages[uniqueMessages.length - 1];
      const isAiPaused = (takeovers[grp.primaryPhone] && Date.now() < takeovers[grp.primaryPhone].pausedUntil) ||
                         (grp.realPhone && takeovers[grp.realPhone] && Date.now() < takeovers[grp.realPhone].pausedUntil);

      conversations.push({
        phone: grp.primaryPhone,
        realPhone: grp.realPhone || (grp.primaryPhone.includes('@lid') ? null : grp.primaryPhone),
        name: lead?.name || 'সম্মানিত কাস্টমার',
        temperature: lead?.temperature || 'warm',
        score: lead?.score || 50,
        status: lead?.status || 'active',
        customerType: lead?.customerType || 'new_lead',
        isAiPaused: !!isAiPaused,
        lastMessage: lastMsg?.text || lead?.lastMessage || '',
        lastMessageTime: lastMsg?.timestamp || lead?.updatedAt || lead?.createdAt || new Date().toISOString(),
        lastMessageRole: lastMsg?.role || 'user',
        messageCount: uniqueMessages.length || lead?.messageCount || 1,
        meta: lastMsg?.meta || {}
      });
    }

    // Sort by latest message time descending
    return conversations.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
  },
  // Human Takeover state
  isAiPausedForUser: (phone) => {
    const db = getDb();
    if (!db.takeovers || !db.takeovers[phone]) return false;
    const takeover = db.takeovers[phone];
    if (Date.now() < takeover.pausedUntil) {
      return true;
    }
    return false;
  },
  setHumanTakeover: (phone, durationMinutes = 30) => {
    const db = getDb();
    if (!db.takeovers) db.takeovers = {};
    db.takeovers[phone] = {
      pausedUntil: Date.now() + (durationMinutes * 60 * 1000),
      reason: 'manual_chat'
    };
    saveDb(db);
    return db.takeovers[phone];
  },
  resumeAiForUser: (phone) => {
    const db = getDb();
    if (db.takeovers && db.takeovers[phone]) {
      delete db.takeovers[phone];
      saveDb(db);
    }
    return true;
  },
  // Orders & Deals CRM
  getOrders: () => getDb().orders || [],
  addOrder: (order) => {
    const db = getDb();
    if (!db.orders) db.orders = [];
    const newOrder = {
      id: 'ord_' + Date.now(),
      phone: order.phone,
      name: order.name || 'কাস্টমার',
      email: order.email || '-',
      pageName: order.pageName || '-',
      item: order.item || 'সার্ভিস প্যাকেজ',
      amount: order.amount || 0,
      notes: order.notes || '',
      status: order.status || 'নতুন অর্ডার (Pending)', // Pending, Confirmed, Completed, Cancelled
      timestamp: new Date().toISOString()
    };
    db.orders.unshift(newOrder);
    db.stats.totalOrders = (db.stats.totalOrders || 0) + 1;
    saveDb(db);
    return newOrder;
  }
};
