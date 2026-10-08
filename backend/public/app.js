async function setCustomerType(phone, newType) {
  try {
    const res = await fetch('/api/leads/set-type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, customerType: newType })
    });
    if (res.ok) {
      showToast('✅ কাস্টমার ক্যাটাগরি আপডেট হয়েছে!');
      loadLeads();
    }
  } catch (e) {
    showToast('❌ আপডেট করা যায়নি');
  }
}

function renderPhoneCell(l) {
  if (l.realPhone) {
    return `<div style="display:flex; align-items:center; gap:6px;">
      <strong style="color:var(--emerald); font-size:13px;">${l.realPhone}</strong>
      <button class="btn btn-xs btn-outline" style="padding:1px 5px; font-size:10px; cursor:pointer;" onclick="promptUpdatePhone('${l.phone}', '${l.name}', '${l.realPhone}')" title="নম্বর এডিট করুন"><i class="fa-solid fa-pen"></i></button>
    </div>`;
  }
  if (l.phone && l.phone.includes('@lid')) {
    return `<div style="display:flex; align-items:center; gap:6px;">
      <span class="badge" style="background:rgba(99,102,241,0.15); color:#a5b4fc; font-size:11px;"><i class="fa-brands fa-whatsapp"></i> চ্যাট আইডি</span>
      <button class="btn btn-xs btn-outline" style="padding:2px 7px; font-size:11px; cursor:pointer;" onclick="promptUpdatePhone('${l.phone}', '${l.name}')"><i class="fa-solid fa-plus"></i> নম্বর দিন</button>
    </div>`;
  }
  return `<div style="display:flex; align-items:center; gap:6px;">
    <span>${l.phone}</span>
    <button class="btn btn-xs btn-outline" style="padding:1px 5px; font-size:10px; cursor:pointer;" onclick="promptUpdatePhone('${l.phone}', '${l.name}', '${l.phone}')" title="এডিট"><i class="fa-solid fa-pen"></i></button>
  </div>`;
}

async function promptUpdatePhone(phone, name, currentRealPhone = '') {
  const newPhone = prompt(`"${name}" কাস্টমারের আসল মোবাইল/হোয়াটসঅ্যাপ নম্বরটি লিখুন (যেমন: 017XXXXXXXX):`, currentRealPhone);
  if (!newPhone || !newPhone.trim()) return;

  try {
    const res = await fetch('/api/leads/update-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, realPhone: newPhone.trim(), name })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('✅ কাস্টমারের নম্বর সফলভাবে সেভ হয়েছে!');
      loadLeads();
      if (typeof fetchInitialData === 'function') fetchInitialData();
    } else {
      showToast(`❌ ${data.error || 'সেভ করা যায়নি'}`);
    }
  } catch (e) {
    showToast('❌ সার্ভার এরর!');
  }
}

const socket = io();

let currentTab = 'overview';
let activeChatPhone = null;
let isCurrentChatAiPaused = false;

// DOM Elements
const socketStatusEl = document.getElementById('socket-status');
const systemHealthDot = document.getElementById('system-health-dot');

const statMessages = document.getElementById('stat-messages');
const statAiReplies = document.getElementById('stat-ai-replies');
const statHotLeads = document.getElementById('stat-hot-leads');
const statOrders = document.getElementById('stat-orders');

const waLoading = document.getElementById('wa-loading');
const waQrContainer = document.getElementById('wa-qr-container');
const waQrImg = document.getElementById('wa-qr-img');
const waConnected = document.getElementById('wa-connected');

const noGateway = document.getElementById('no-gateway');
const gatewayList = document.getElementById('gateway-list');
const gatewayBadge = document.getElementById('gateway-badge');

const liveLeadsBody = document.getElementById('live-leads-body');
const allLeadsBody = document.getElementById('all-leads-body');
const allOrdersBody = document.getElementById('all-orders-body');
const allCallsBody = document.getElementById('all-calls-body');

// Navigation Tabs
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));

    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabName}`).classList.add('active');
    currentTab = tabName;

    if (tabName === 'leads') loadLeads();
    if (tabName === 'orders') loadOrders();
    if (tabName === 'calls') loadCalls();
    if (tabName === 'settings') loadSettings();
  });
});

// Socket Events
socket.on('connect', () => {
  socketStatusEl.textContent = 'রিয়েল-টাইম কানেক্টেড';
  systemHealthDot.style.background = 'var(--emerald)';
  fetchInitialData();
});

socket.on('disconnect', () => {
  socketStatusEl.textContent = 'কানেকশন বিচ্ছিন্ন';
  systemHealthDot.style.background = 'var(--rose)';
});

socket.on('whatsapp_status', (data) => {
  updateWhatsAppUI(data.status, data.qr);
});

socket.on('whatsapp_qr', (data) => {
  updateWhatsAppUI(data.status, data.qr);
});

socket.on('gateways_update', (gateways) => {
  updateGatewaysUI(gateways);
});

socket.on('auto_reply_status_changed', (data) => {
  updateMasterToggleUI(data.enabled);
  showToast(data.enabled ? '🟢 AI অটো-রিপ্লাই চালু করা হয়েছে' : '🔴 AI অটো-রিপ্লাই বন্ধ করা হয়েছে');
});

socket.on('new_lead', (lead) => {
  showToast(`📩 নতুন মেসেজ: ${lead.name} (${lead.phone})`);
  loadLeads();
  fetchStats();
});

socket.on('new_order', (order) => {
  showToast(`🎉 নতুন অর্ডার: ${order.name} (${order.item})`);
  loadOrders();
  fetchStats();
});

socket.on('chat_message', (msg) => {
  if (msg.role === 'assistant') {
    showToast(`🤖 AI রিপ্লাই পাঠানো হয়েছে: ${msg.phone}`);
  }
  if (activeChatPhone === msg.phone) {
    loadChatHistory(msg.phone);
  }
  loadLeads();
  fetchStats();
});

socket.on('lead_status_update', ({ phone, status }) => {
  loadLeads();
  fetchStats();
});

socket.on('lead_temperature_update', ({ phone, temperature, score }) => {
  loadLeads();
  fetchStats();
});

socket.on('stats_update', (stats) => {
  updateStats(stats);
});

socket.on('call_completed', (callRecord) => {
  showToast(`📞 কল সম্পন্ন হয়েছে: ${callRecord.leadName} (${callRecord.interestLevel})`);
  loadCalls();
  loadLeads();
  fetchStats();
});

// Update WhatsApp UI
function updateWhatsAppUI(status, qr) {
  waLoading.classList.add('hidden');
  waQrContainer.classList.add('hidden');
  waConnected.classList.add('hidden');

  if (status === 'connected') {
    waConnected.classList.remove('hidden');
  } else if (status === 'waiting_for_qr_scan' && qr) {
    waQrImg.src = qr;
    waQrContainer.classList.remove('hidden');
  } else {
    waLoading.classList.remove('hidden');
  }
}

// Update Gateways UI (if element exists)
function updateGatewaysUI(gateways) {
  if (!noGateway || !gatewayList || !gatewayBadge) return;
  if (!gateways || gateways.length === 0) {
    noGateway.classList.remove('hidden');
    gatewayList.classList.add('hidden');
    gatewayBadge.innerHTML = `<span class="badge badge-danger">০টি কানেক্টেড</span>`;
  } else {
    noGateway.classList.add('hidden');
    gatewayList.classList.remove('hidden');
    gatewayBadge.innerHTML = `<span class="badge badge-success">${gateways.length}টি ফোন কানেক্টেড</span>`;

    gatewayList.innerHTML = gateways.map(g => `
      <div class="gateway-item">
        <div class="gateway-info">
          <div class="gateway-icon">
            <i class="fa-solid fa-mobile-screen"></i>
          </div>
          <div>
            <div class="gateway-title">${g.deviceName}</div>
            <div class="gateway-sim">SIM Slot ${g.simSlot} • অনলাইন</div>
          </div>
        </div>
        <span class="badge badge-success">সক্রিয়</span>
      </div>
    `).join('');
  }
}

async function fetchInitialData() {
  await fetchStats();
  await loadLeads();
  await loadOrders();
  await loadCalls();
}

let isMasterAutoReplyEnabled = false;

function updateMasterToggleUI(enabled) {
  isMasterAutoReplyEnabled = !!enabled;
  const btn = document.getElementById('master-ai-toggle-btn');
  const settingsCheckbox = document.getElementById('setting-whatsappAiReplyEnabled');
  
  if (settingsCheckbox) {
    settingsCheckbox.checked = isMasterAutoReplyEnabled;
  }

  if (btn) {
    if (isMasterAutoReplyEnabled) {
      btn.innerHTML = `<i class="fa-solid fa-power-off"></i> চালু (ON)`;
      btn.style.background = 'var(--emerald)';
      btn.style.color = '#fff';
      btn.style.border = 'none';
    } else {
      btn.innerHTML = `<i class="fa-solid fa-power-off"></i> বন্ধ (OFF)`;
      btn.style.background = 'rgba(239, 68, 68, 0.2)';
      btn.style.color = '#f87171';
      btn.style.border = '1px solid rgba(239, 68, 68, 0.4)';
    }
  }
}

async function toggleMasterAutoReply() {
  const newStatus = !isMasterAutoReplyEnabled;
  try {
    const res = await fetch('/api/settings/toggle-auto-reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      updateMasterToggleUI(data.enabled);
    }
  } catch (err) {
    showToast('❌ অটো-রিপ্লাই পরিবর্তন করা যায়নি');
  }
}

async function fetchStats() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStats(data.stats);
    updateWhatsAppUI(data.whatsapp.status, data.whatsapp.qr);
    updateGatewaysUI(data.gateways);

    const settingsRes = await fetch('/api/settings');
    const settingsData = await settingsRes.json();
    updateMasterToggleUI(settingsData.whatsappAiReplyEnabled);
  } catch (err) {}
}

function updateStats(stats) {
  if (!stats) return;
  if (statMessages) statMessages.textContent = stats.totalMessages || 0;
  if (statAiReplies) statAiReplies.textContent = stats.totalAiReplies || 0;
  if (statHotLeads) statHotLeads.textContent = stats.hotLeads || 0;
  if (statOrders) statOrders.textContent = stats.totalOrders || 0;
}

function getTemperatureBadge(temp) {
  if (temp === 'hot') {
    return `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4);"><i class="fa-solid fa-fire"></i> Hot</span>`;
  } else if (temp === 'cold') {
    return `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #94a3b8;"><i class="fa-solid fa-snowflake"></i> Cold</span>`;
  } else {
    return `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;"><i class="fa-solid fa-bolt"></i> Warm</span>`;
  }
}

// Load Leads
async function loadLeads() {
  try {
    const res = await fetch('/api/leads');
    const leads = await res.json();

    const getStatusBadge = (status) => {
      switch(status) {
        case 'interested': return `<span class="badge badge-success">আগ্রহী</span>`;
        case 'calling': return `<span class="badge badge-warning"><i class="fa-solid fa-phone fa-shake"></i> কল চলছে...</span>`;
        case 'not_interested': return `<span class="badge badge-danger">আগ্রহী নন</span>`;
        case 'pending_call': return `<span class="badge badge-warning">অটো-রিপ্লাইড</span>`;
        default: return `<span class="badge badge-outline">${status}</span>`;
      }
    };

    const renderRow = (l) => `
      <tr>
        <td>
          <b>${l.name || 'কাস্টমার'}</b><br>
          <div style="margin-top: 3px;">${renderPhoneCell(l)}</div>
        </td>
        <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${l.lastMessage || '-'}
        </td>
        <td>${getTemperatureBadge(l.temperature)}</td>
        <td>${getStatusBadge(l.status)}</td>
        <td style="font-size: 12px; color: var(--text-secondary);">
          ${new Date(l.updatedAt || l.createdAt).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline" onclick="openChatModal('${l.phone}', '${l.name}', '${l.temperature || 'warm'}')">
              <i class="fa-brands fa-whatsapp"></i> চ্যাট
            </button>
            <button class="btn btn-sm btn-primary" onclick="triggerDirectCall('${l.phone}', '${l.name}')">
              <i class="fa-solid fa-phone"></i> কল
            </button>
          </div>
        </td>
      </tr>
    `;

    liveLeadsBody.innerHTML = leads.slice(0, 6).map(renderRow).join('') || '<tr><td colspan="6" class="text-center py-4">কোনো মেসেজ নেই।</td></tr>';
    allLeadsBody.innerHTML = leads.map(l => `
      <tr>
        <td><b>${l.name}</b></td>
        <td>${renderPhoneCell(l)}</td>
        <td>${l.messageCount || 1}</td>
        <td>${getTemperatureBadge(l.temperature)}</td>
        <td style="max-width: 300px;">${l.lastMessage || '-'}</td>
        <td>${getStatusBadge(l.status)}</td>
        <td>${new Date(l.createdAt).toLocaleString('bn-BD')}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline" onclick="openChatModal('${l.phone}', '${l.name}', '${l.temperature || 'warm'}')">
              <i class="fa-brands fa-whatsapp"></i> চ্যাট
            </button>
            <button class="btn btn-sm btn-primary" onclick="triggerDirectCall('${l.phone}', '${l.name}')">
              <i class="fa-solid fa-phone"></i> কল
            </button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="text-center py-4">কোনো লিড রেকর্ড নেই।</td></tr>';
  } catch (err) {
    console.error('Failed to load leads:', err);
  }
}

// Load Orders CRM
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();

    allOrdersBody.innerHTML = orders.map(o => `
      <tr>
        <td><code style="color: var(--indigo); font-weight: bold;">#${o.id.replace('ord_', '').substring(6)}</code></td>
        <td>
          <b>${o.name}</b><br>
          <span style="font-size: 12px; color: var(--text-secondary);">${o.phone}</span>
        </td>
        <td style="font-size: 13px;">${o.email || '-'}</td>
        <td style="font-weight: 500; color: #38bdf8;">${o.pageName || '-'}</td>
        <td><b>${o.item}</b></td>
        <td>
          <span class="badge badge-success">
            <i class="fa-solid fa-circle-check"></i> ${o.status || 'নতুন অর্ডার'}
          </span>
        </td>
        <td style="font-size: 12px; color: var(--text-secondary);">${new Date(o.timestamp).toLocaleString('bn-BD')}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-outline" onclick="openChatModal('${o.phone}', '${o.name}', 'hot')">
              <i class="fa-brands fa-whatsapp"></i> চ্যাট
            </button>
            <button class="btn btn-sm btn-primary" onclick="triggerDirectCall('${o.phone}', '${o.name}')">
              <i class="fa-solid fa-phone"></i> কল
            </button>
          </div>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" class="text-center py-4">কোনো অর্ডার রেকর্ড নেই।</td></tr>';
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

// Load Calls
async function loadCalls() {
  try {
    const res = await fetch('/api/calls');
    const calls = await res.json();

    allCallsBody.innerHTML = calls.map(c => `
      <tr>
        <td>
          <b>${c.leadName}</b><br>
          <span style="font-size: 12px; color: var(--text-secondary);">${c.phone}</span>
        </td>
        <td>${c.durationSeconds} সেকেন্ড</td>
        <td>
          <span class="badge ${c.interestLevel === 'interested' ? 'badge-success' : 'badge-warning'}">
            ${c.interestLevel}
          </span>
        </td>
        <td style="max-width: 400px; line-height: 1.4;">${c.summary || c.transcript || '-'}</td>
        <td>${new Date(c.timestamp).toLocaleString('bn-BD')}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="text-center py-4">কোনো কল রেকর্ড নেই।</td></tr>';
  } catch (err) {
    console.error('Failed to load calls:', err);
  }
}

// Handle Direct Image File Upload
async function handleDirectUpload(category, input) {
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64Data = e.target.result;
    const ext = file.name.split('.').pop() || 'png';

    showToast(`⏳ ${category === 'hosting' ? 'হোস্টিং' : 'ওয়েবসাইট'} ছবি আপলোড হচ্ছে...`);

    try {
      const res = await fetch('/api/upload-catalog-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          base64Data,
          extension: ext
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast(`✅ ${data.message}`);
        updateImagePreview(category, data.imageUrl);
      } else {
        showToast(`❌ ${data.error || 'আপলোড ব্যর্থ হয়েছে'}`);
      }
    } catch (err) {
      showToast('❌ সার্ভার এরর!');
    }
  };
  reader.readAsDataURL(file);
}

function updateImagePreview(category, url) {
  const imgEl = document.getElementById(`${category}-img-preview`);
  const emptyEl = document.getElementById(`${category}-img-empty`);
  const hiddenInput = document.getElementById(`setting-${category}ImageUrl`);

  if (hiddenInput) hiddenInput.value = url || '';

  if (url) {
    if (imgEl) {
      imgEl.src = url;
      imgEl.style.display = 'block';
    }
    if (emptyEl) emptyEl.style.display = 'none';
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
  }
}

// Load & Save Settings
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    document.getElementById('setting-businessName').value = s.businessName || '';
    document.getElementById('setting-agentName').value = s.agentName || '';
    document.getElementById('setting-serviceDescription').value = s.serviceDescription || '';
    
    if (document.getElementById('setting-websiteUrl')) {
      document.getElementById('setting-websiteUrl').value = s.websiteUrl || '';
    }
    if (document.getElementById('setting-knowledgeBase')) {
      document.getElementById('setting-knowledgeBase').value = s.knowledgeBase || '';
    }
    
    if (document.getElementById('setting-aiProvider')) {
      document.getElementById('setting-aiProvider').value = s.aiProvider || 'gemini';
    }
    if (document.getElementById('setting-geminiKey')) {
      document.getElementById('setting-geminiKey').value = s.geminiApiKey || '';
    }
    document.getElementById('setting-groqKey').value = s.groqApiKey || '';
    document.getElementById('setting-autoCallDelay').value = s.autoCallDelaySeconds || 15;
    
    updateImagePreview('hosting', s.mediaCatalog?.hostingImageUrl);
    updateImagePreview('website', s.mediaCatalog?.websiteImageUrl);
    
    document.getElementById('setting-whatsappAiReplyEnabled').checked = s.whatsappAiReplyEnabled !== false;
    document.getElementById('setting-voiceNoteTranscribeEnabled').checked = s.voiceNoteTranscribeEnabled !== false;
    document.getElementById('setting-humanTypingDelay').checked = s.humanTypingDelay !== false;
    document.getElementById('setting-postCallSummaryWhatsAppEnabled').checked = s.postCallSummaryWhatsAppEnabled !== false;
    document.getElementById('setting-autoCallEnabled').checked = !!s.autoCallEnabled;
    
    document.getElementById('setting-telegramNotificationEnabled').checked = !!s.telegramNotificationEnabled;
    document.getElementById('setting-telegramBotToken').value = s.telegramBotToken || '';
    document.getElementById('setting-telegramChatId').value = s.telegramChatId || '';

    document.getElementById('setting-whatsappChatPrompt').value = s.whatsappChatPrompt || '';
    document.getElementById('setting-systemPrompt').value = s.systemPrompt || '';
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    businessName: document.getElementById('setting-businessName').value,
    agentName: document.getElementById('setting-agentName').value,
    serviceDescription: document.getElementById('setting-serviceDescription').value,
    websiteUrl: document.getElementById('setting-websiteUrl')?.value || '',
    knowledgeBase: document.getElementById('setting-knowledgeBase')?.value || '',
    aiProvider: document.getElementById('setting-aiProvider')?.value || 'gemini',
    geminiApiKey: document.getElementById('setting-geminiKey')?.value || '',
    groqApiKey: document.getElementById('setting-groqKey').value,
    autoCallDelaySeconds: parseInt(document.getElementById('setting-autoCallDelay').value, 10),
    mediaCatalog: {
      hostingImageUrl: document.getElementById('setting-hostingImageUrl')?.value || '',
      websiteImageUrl: document.getElementById('setting-websiteImageUrl')?.value || ''
    },
    whatsappAiReplyEnabled: document.getElementById('setting-whatsappAiReplyEnabled').checked,
    voiceNoteTranscribeEnabled: document.getElementById('setting-voiceNoteTranscribeEnabled').checked,
    humanTypingDelay: document.getElementById('setting-humanTypingDelay').checked,
    postCallSummaryWhatsAppEnabled: document.getElementById('setting-postCallSummaryWhatsAppEnabled').checked,
    autoCallEnabled: document.getElementById('setting-autoCallEnabled').checked,
    telegramNotificationEnabled: document.getElementById('setting-telegramNotificationEnabled').checked,
    telegramBotToken: document.getElementById('setting-telegramBotToken').value,
    telegramChatId: document.getElementById('setting-telegramChatId').value,
    whatsappChatPrompt: document.getElementById('setting-whatsappChatPrompt').value,
    systemPrompt: document.getElementById('setting-systemPrompt').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('✅ সেটিংস ও নলেজ বেস সফলভাবে সংরক্ষিত হয়েছে!');
    }
  } catch (err) {
    showToast('❌ সেটিংস সেভ করতে সমস্যা হয়েছে!');
  }
});

// Live Human Takeover & Chat Modal Handlers
async function openChatModal(phone, name, temp) {
  activeChatPhone = phone;
  document.getElementById('chat-modal-title').textContent = `${name || 'কাস্টমার'} (${phone})`;
  document.getElementById('chat-temp-badge').innerHTML = getTemperatureBadge(temp);
  document.getElementById('chat-modal').classList.remove('hidden');
  await loadChatHistory(phone);
}

function closeChatModal() {
  activeChatPhone = null;
  document.getElementById('chat-modal').classList.add('hidden');
}

async function loadChatHistory(phone) {
  const container = document.getElementById('chat-messages-container');
  try {
    const res = await fetch(`/api/chat/${phone}`);
    const data = await res.json();
    const history = data.history || [];
    isCurrentChatAiPaused = data.isAiPaused;

    // Update status & pause button
    const statusEl = document.getElementById('chat-ai-status');
    const toggleBtn = document.getElementById('btn-toggle-ai-pause');
    if (isCurrentChatAiPaused) {
      statusEl.innerHTML = `<span style="color: #f87171;"><i class="fa-solid fa-user-shield"></i> AI পজ করা (Human Takeover Active)</span>`;
      toggleBtn.innerHTML = `<i class="fa-solid fa-play"></i> AI চালু করুন`;
      toggleBtn.className = 'btn btn-sm btn-primary';
    } else {
      statusEl.innerHTML = `<span style="color: var(--emerald);"><i class="fa-solid fa-robot"></i> AI অটো-রিপ্লাই সক্রিয়</span>`;
      toggleBtn.innerHTML = `<i class="fa-solid fa-pause"></i> AI পজ করুন`;
      toggleBtn.className = 'btn btn-sm btn-outline';
    }

    if (!history || history.length === 0) {
      container.innerHTML = '<p class="text-center" style="color: var(--text-secondary); padding: 20px;">কোনো চ্যাট হিস্ট্রি পাওয়া যায়নি।</p>';
      return;
    }

    container.innerHTML = history.map(m => {
      const isUser = m.role === 'user';
      const isHuman = m.role === 'human_agent';
      
      let bgStyle = isUser 
        ? 'rgba(255,255,255,0.08)' 
        : (isHuman ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : 'linear-gradient(135deg, var(--emerald), #059669)');

      let senderLabel = isUser ? '👤 কাস্টমার' : (isHuman ? '👤 আপনি (Human)' : '🤖 AI অ্যাসিস্ট্যান্ট');

      return `
        <div style="display: flex; justify-content: ${isUser ? 'flex-start' : 'flex-end'}; margin-bottom: 12px;">
          <div style="max-width: 80%; padding: 10px 14px; border-radius: 12px; background: ${bgStyle}; color: #fff; font-size: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">
            <div style="font-size: 11px; opacity: 0.75; margin-bottom: 3px;">
              ${senderLabel} • ${new Date(m.timestamp).toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style="white-space: pre-wrap; word-break: break-word;">${m.text}</div>
          </div>
        </div>
      `;
    }).join('');
    
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = '<p class="text-danger">হিস্ট্রি লোড করা যায়নি</p>';
  }
}

async function sendManualChatMessage() {
  const input = document.getElementById('manual-chat-input');
  const message = input.value.trim();
  if (!message || !activeChatPhone) return;

  try {
    input.value = '';
    const res = await fetch('/api/chat/send-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: activeChatPhone, message, pauseMinutes: 30 })
    });
    if (res.ok) {
      showToast('📤 মেসেজ পাঠানো হয়েছে (AI ৩০ মিনিটের জন্য পজ করা হলো)');
      await loadChatHistory(activeChatPhone);
    } else {
      showToast('❌ মেসেজ পাঠানো যায়নি');
    }
  } catch (err) {
    showToast('❌ সার্ভার এরর!');
  }
}

function handleChatKeyPress(event) {
  if (event.key === 'Enter') {
    sendManualChatMessage();
  }
}

async function toggleAiPause() {
  if (!activeChatPhone) return;
  const newPauseState = !isCurrentChatAiPaused;
  try {
    await fetch('/api/chat/toggle-ai-pause', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: activeChatPhone, pause: newPauseState })
    });
    showToast(newPauseState ? '⏸️ AI পজ করা হয়েছে' : '▶️ AI চালু করা হয়েছে');
    await loadChatHistory(activeChatPhone);
  } catch (err) {
    showToast('❌ স্টেটাস পরিবর্তন করা যায়নি');
  }
}

// Trigger Calls
async function triggerDirectCall(phone, name) {
  try {
    const res = await fetch('/api/leads/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`📞 কল রিকোয়েস্ট পাঠানো হয়েছে ${phone} নম্বরে!`);
    } else {
      showToast(`❌ ${data.error || 'কল পাঠানো যায়নি'}`);
    }
  } catch (err) {
    showToast('❌ সার্ভার এরর!');
  }
}

// Modal Handlers
function openTestChatModal() {
  const modal = document.getElementById('test-chat-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeTestChatModal() {
  const modal = document.getElementById('test-chat-modal');
  if (modal) modal.classList.add('hidden');
}

async function submitTestChat() {
  const query = document.getElementById('test-chat-query')?.value?.trim();
  const name = document.getElementById('test-chat-name')?.value?.trim() || 'রহিম ভাই';
  if (!query) {
    showToast('⚠️ অনুগ্রহ করে একটি প্রশ্ন বা মেসেজ লিখুন!');
    return;
  }

  const btn = document.getElementById('test-chat-btn');
  const resultBox = document.getElementById('test-chat-result-box');
  const replyText = document.getElementById('test-chat-reply-text');
  const metaBox = document.getElementById('test-chat-meta');

  if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AI ভাবছে...';
  if (resultBox) resultBox.classList.add('hidden');

  try {
    const res = await fetch('/api/ai/test-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, name })
    });
    const data = await res.json();
    if (data.success && data.reply) {
      if (replyText) replyText.textContent = data.reply.replyText || 'উত্তর পাওয়া যায়নি';
      if (metaBox) {
        metaBox.innerHTML = `🔥 টেম্পারেচার: <b>${data.reply.temperature}</b> | 🎯 লিড স্কোর: <b>${data.reply.score}/100</b> ${data.reply.imageCategory ? `| 📸 প্যাকেজ ছবি: <b>${data.reply.imageCategory}</b>` : ''}`;
      }
      if (resultBox) resultBox.classList.remove('hidden');
    } else {
      showToast('❌ এরর: ' + (data.error || 'AI উত্তর তৈরি করতে পারেনি'));
    }
  } catch (err) {
    showToast('❌ সার্ভার কানেকশন এরর!');
  } finally {
    if (btn) btn.innerHTML = '<i class="fa-solid fa-bolt"></i> টেস্ট উত্তর দেখুন';
  }
}

async function restartWhatsApp() {
  if (confirm('হোয়াটসঅ্যাপ সেশন রিস্টার্ট করতে চান?')) {
    showToast('⏳ হোয়াটসঅ্যাপ রিস্টার্ট হচ্ছে...');
    await fetch('/api/whatsapp/restart', { method: 'POST' });
  }
}

async function clearAndRescanWhatsApp() {
  if (confirm('পূর্ববর্তী সেশন মুছে ফেলে নতুন করে WhatsApp QR Code স্ক্যান করতে চান?')) {
    showToast('🧹 সেশন ক্লিয়ার হচ্ছে... নতুন QR কোড তৈরি হচ্ছে');
    try {
      const res = await fetch('/api/whatsapp/clear-session', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('📲 অনুগ্রহ করে নতুন QR কোডটি আপনার WhatsApp দিয়ে স্ক্যান করুন');
      } else {
        showToast('❌ এরর: ' + (data.error || 'সেশন রিসেট করা যায়নি'));
      }
    } catch (e) {
      showToast('❌ সার্ভার এরর');
    }
  }
}

// Toast Helper
function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fa-solid fa-circle-info text-indigo"></i> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}
