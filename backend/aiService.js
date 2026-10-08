const db = require('./database');
const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');
const axios = require('axios');

class AIService {
  constructor() {
    this.groq = null;
    this.initProviders();
  }

  initProviders() {
    const settings = db.getSettings();
    const groqKey = settings.groqApiKey || process.env.GROQ_API_KEY;
    if (groqKey && groqKey.startsWith('gsk_')) {
      try {
        this.groq = new Groq({ apiKey: groqKey });
      } catch (e) {
        console.warn('Groq Init Error:', e.message);
      }
    }
  }

  initGroq() {
    this.initProviders();
  }

  getCompiledSystemPrompt(lead) {
    const settings = db.getSettings();
    let prompt = settings.systemPrompt || '';
    prompt = prompt.replace(/{agentName}/g, settings.agentName || 'সাদিয়া');
    prompt = prompt.replace(/{businessName}/g, settings.businessName || 'Sohag Online');
    prompt = prompt.replace(/{serviceDescription}/g, settings.serviceDescription || 'ডিজিটাল সার্ভিস');
    prompt = prompt.replace(/{name}/g, lead.name || 'সম্মানিত কাস্টমার');
    prompt = prompt.replace(/{lastMessage}/g, lead.lastMessage || 'হাই');
    return prompt;
  }

  getCompiledWhatsAppPrompt(lead) {
    const settings = db.getSettings();
    let prompt = settings.whatsappChatPrompt || settings.systemPrompt || '';
    prompt = prompt.replace(/{agentName}/g, settings.agentName || 'সাদিয়া');
    prompt = prompt.replace(/{businessName}/g, settings.businessName || 'Sohag Online');
    prompt = prompt.replace(/{serviceDescription}/g, settings.serviceDescription || 'ডিজিটাল সার্ভিস');
    prompt = prompt.replace(/{name}/g, lead.name || 'সম্মানিত কাস্টমার');
    prompt = prompt.replace(/{lastMessage}/g, lead.lastMessage || 'হাই');
    return prompt;
  }

  /**
   * Google Gemini API Direct Caller (Supporting gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.1-flash-lite)
   */
  async callGemini(apiKey, systemInstruction, history = [], userPrompt = '', isJson = false, imageBuffer = null, imageMime = 'image/jpeg') {
    if (!apiKey) return null;

    const contents = [];
    for (const h of history) {
      contents.push({
        role: (h.role === 'assistant' || h.role === 'model') ? 'model' : 'user',
        parts: [{ text: h.content || h.text || '' }]
      });
    }
    
    const userParts = [{ text: userPrompt }];
    if (imageBuffer) {
      const base64 = Buffer.isBuffer(imageBuffer) ? imageBuffer.toString('base64') : imageBuffer;
      userParts.unshift({
        inline_data: {
          mime_type: imageMime || 'image/jpeg',
          data: base64
        }
      });
    }

    contents.push({
      role: 'user',
      parts: userParts
    });

    const modelsToTry = [
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash'
    ];

    for (const model of modelsToTry) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: contents,
          generationConfig: {
            maxOutputTokens: 650,
            temperature: 0.3,
            responseMimeType: isJson ? 'application/json' : undefined
          }
        };
        const res = await axios.post(url, payload, { timeout: 15000 });
        const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      } catch (err) {
        console.warn(`Gemini (${model}) API Error:`, err.response?.data?.error?.message || err.message);
      }
    }
    return null;
  }

  /**
   * Transcribe WhatsApp audio/voice note using Groq Whisper with Gemini Audio Fallback
   */
  async transcribeAudio(audioBuffer, filename = 'voice.ogg') {
    this.initProviders();
    const settings = db.getSettings();

    // 1. Try Groq Whisper (Ultra fast < 400ms)
    if (this.groq) {
      const whisperModels = ['whisper-large-v3-turbo', 'whisper-large-v3'];
      for (const wm of whisperModels) {
        try {
          const file = await toFile(audioBuffer, filename);
          const transcription = await this.groq.audio.transcriptions.create({
            file: file,
            model: wm,
            language: 'bn',
            response_format: 'verbose_json'
          });

          const text = transcription.text?.trim();
          if (text && text.length > 1) {
            return text;
          }
        } catch (err) {
          console.warn(`Groq Whisper (${wm}) Error:`, err.message);
        }
      }
    }

    // 2. Fallback to Gemini Multimodal Audio
    const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (geminiKey && audioBuffer) {
      const modelsToTry = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
      for (const model of modelsToTry) {
        try {
          const base64Audio = Buffer.isBuffer(audioBuffer) ? audioBuffer.toString('base64') : audioBuffer;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
          const payload = {
            contents: [{
              parts: [
                { inline_data: { mime_type: 'audio/ogg', data: base64Audio } },
                { text: 'এই অডিও বা ভয়েস মেসেজটিতে কাস্টমার স্পষ্ট বা কথ্য বাংলায় যা বলেছেন তা হুবহু টেক্সটে লিখে দাও। অতিরিক্ত কোনো মন্তব্য বা ভূমিকা লিখবে না।' }
              ]
            }]
          };
          const res = await axios.post(url, payload, { timeout: 15000 });
          const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text && text.length > 1) {
            return text;
          }
        } catch (geminiErr) {
          console.warn(`Gemini Audio Transcription (${model}) Error:`, geminiErr.response?.data?.error?.message || geminiErr.message);
        }
      }
    }

    return null;
  }

  /**
   * Dual-AI Conversational WhatsApp Engine with Full Context Memory & 100% Real Human Persona
   */
  async generateWhatsAppReply(lead, conversationHistory = [], userMessage = '', imageBuffer = null, imageMime = 'image/jpeg') {
    this.initProviders();
    const settings = db.getSettings();
    const isExisting = db.isExistingCustomer(lead.phone, lead.realPhone);

    const businessName = settings.businessName || 'Sohag Online';
    const agentName = settings.agentName || 'সাদিয়া';
    const customerDisplayName = lead.name && lead.name !== 'সম্মানিত কাস্টমার' ? lead.name : 'ভাই';

    // Format chat history for context awareness
    const historyList = (conversationHistory || []).map(msg => ({
      role: (msg.role === 'assistant' || msg.role === 'human_agent' || msg.role === 'model') ? 'model' : 'user',
      content: (msg.text || msg.content || '').trim()
    })).filter(m => m.content.length > 0);

    const hasPriorDialogue = historyList.length > 0;

    // Master Human Persona System Instruction
    const strictSystemInstruction = `তুমি ${businessName} এর প্রধান সিনিয়র সেলস ও কাস্টমার রিলেশনশিপ কনসালট্যান্ট। তোমার নাম ${agentName}।
তোমার একমাত্র দায়িত্ব: কাস্টমারের সাথে ১০০% বাস্তব, আন্তরিক, বুদ্ধিমান ও অভিজ্ঞ মানুষের মতো হোয়াটসঅ্যাপে কথা বলা। কোনো অবস্থাতেই যেন রোবোটিক বা মুখস্থ উত্তর না মনে হয়।

👤 কাস্টমার প্রোফাইল:
- নাম: ${customerDisplayName}
- নম্বর: ${lead.realPhone || lead.phone}
- কাস্টমার স্ট্যাটাস: ${hasPriorDialogue ? 'চলমান কথোপকথন (Already in Active Conversation)' : 'নতুন বার্তা (First Message)'}

📜 আমাদের অফিসিয়াল সার্ভিস ও অফার নলেজবেস (Sohag Online Knowledge Base):
${settings.knowledgeBase || ''}

🎯 কঠোর নিয়মাবলী (Human-Like Rules):
১. চ্যাট হিস্ট্রি (Conversation History) গভীর মনোযোগ দিয়ে বুঝবে:
   - কাস্টমার আগে কী জানতে চেয়েছেন এবং তুমি আগে কী উত্তর দিয়েছ তা মনে রাখবে।
   - চলমান কথোপকথন থাকলে বারবার "আসসালামু আলাইকুম" বা ওয়েলকাম ভূমিকা দেবে না! সরাসরি কাস্টমারের প্রশ্নের জবাব দেবে।
   - কাস্টমার যদি আগের কথার সূত্র ধরে প্রশ্ন করে (যেমন: "এটার সাথে ডোমেইন পাবো?", "ডেমো লিংকটা দেন", "কতদিন লাগবে?"), বুঝবে সে কোন সার্ভিস নিয়ে কথা বলছিল এবং সেই অনুযায়ী সঠিক তথ্য দেবে।
   - অপ্রাসঙ্গিক লম্বা লেকচার দেবে না। স্বাভাবিক মানুষের মতো সংক্ষিপ্ত (১-৩ বাক্য) কিন্তু পূর্ণাঙ্গ তথ্যবহুল উত্তর দেবে।

২. আমাদের মূল সার্ভিস ও প্রাইসিং গাইডলাইন:
   - ল্যান্ডিং পেজ: মাত্র ১,৪৯৯ টাকা (লাইফটাইম বিজনেস অটোমেশন, অর্ডার ম্যানেজমেন্ট, কুরিয়ার ইন্টিগ্রেশন, পিক্সেল ট্র্যাকিং + ১ বছরের .SHOP ডোমেইন ও ১ম মাসের হোস্টিং ফ্রি)। ডেমো: landing.sohagonline.com
   - কমপ্লিট ই-কমার্স ওয়েবসাইট + আনলিমিটেড ল্যান্ডিং পেজ: মাত্র ৩,৫০০ টাকা (লারাভেল + রিঅ্যাক্ট + নেক্সট জেএস, সুপার ফাস্ট, আনলিমিটেড ল্যান্ডিং পেজ তৈরির সুবিধা, এডমিন ডেমো: sohagonline.cloud/admin, ইউজার: demo@gmail.com, পাস: demo@gmail.com)। ডেমো: sohagonline.cloud
   - ফেসবুক বুস্টিং: ডলার রেট $1 = ১৪৫ টাকা, প্রতিদিন সর্বনিম্ন $2 বাজেট থেকে শুরু। আমাদের পেজে ফ্রেন্ড রিকোয়েস্ট ও এক্সেস দিন (facebook.com/sohag0006) এবং ফর্ম পূরণ করুন (billing.sohagonline.com/boosting)।
   - ডোমেন ও হোস্টিং রিনিউ: ১ম মাস ফ্রি এর পর প্রতি মাসে মাত্র ২০০ টাকা। নিজস্ব ডোমেন/হোস্টিং থাকলে লাইফটাইম ফ্রি (কোনো মাসিক চার্জ নেই)।
   - পেমেন্ট নম্বর (Send Money): বিকাশ: 01953334002 | রকেট: 019533340027 | নগদ/সেলফিন: 01518393559 | QR: billing.sohagonline.com/pay?method=qr

৩. কাস্টমার যদি ছবি/স্ক্রিনশট পাঠায়:
   - পেমেন্ট স্লিপ হলে টাকা ও TrxID শনাক্ত করে "isPaymentScreenshot": true দেবে এবং সুন্দরভাবে ধন্যবাদ জানিয়ে ওয়েবসাইটের তথ্য চাইবে।
   - ওয়েবসাইট রেফারেন্স পাঠালে বলবে যে আমরা ঠিক এরকম আকর্ষণীয় ডিজাইন করে দিতে পারবো।

৪. কাস্টমার যদি ফোনে কথা বলতে বা কল দিতে বলে:
   - "wantsCall": true সেট করবে এবং আশ্বস্ত করবে যে প্রতিনিধি দ্রুত কল দিচ্ছেন।

৫. উত্তরের ভাষা ও টোন:
   - মিষ্টি, আন্তরিক ও প্রমিত বাংলাদেশি বাংলা ভাষা। কাস্টমার বাংলিশে লিখলেও তুমি সুন্দর সহজ বাংলায় উত্তর দেবে।
   - উত্তরের শেষে আলোচনাকে এগিয়ে নেওয়ার জন্য একটি স্বাভাবিক প্রশ্ন করবে।

আউটপুট অবশ্যই ভ্যালিড JSON ফরমেটে দেবে:
{
  "replyText": "কাস্টমারের বর্তমান বার্তার সরাসরি ও প্রাসঙ্গিক মানুষের মতো উত্তর",
  "imageCategory": "hosting" | "website" | null,
  "wantsCall": boolean,
  "temperature": "hot" | "warm" | "cold",
  "score": number,
  "isOrderConfirmed": boolean,
  "isSupportIssue": boolean,
  "isPaymentScreenshot": boolean,
  "paymentAmount": number,
  "trxId": string,
  "customerName": string,
  "customerPhone": string,
  "customerEmail": string,
  "pageName": string,
  "packageItem": string,
  "estimatedAmount": number
}`;

    // Ensure we pass last 15 conversation turns
    const formattedHistory = historyList.slice(-15);

    // Avoid duplicating the current user message at the tail
    if (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user' && formattedHistory[formattedHistory.length - 1].content.trim() === userMessage.trim()) {
      formattedHistory.pop();
    }

    let parsedResult = null;
    const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

    // 1. Primary AI Engine: Google Gemini 3.5 Flash (Superior Multimodal Reasoning)
    if (geminiKey) {
      try {
        const jsonStr = await this.callGemini(
          geminiKey,
          strictSystemInstruction,
          formattedHistory,
          `কাস্টমারের বর্তমান মেসেজ: "${userMessage}"${imageBuffer ? ' (কাস্টমার একটি ছবি/স্ক্রিনশট পাঠিয়েছেন, এটি বিশ্লেষণ করো)' : ''}\nবিগত চ্যাট হিস্ট্রি এবং সোহাগ অনলাইনের তথ্যের আলোকে একজন বিচক্ষণ মানুষের মতো সঠিক JSON রেসপন্স দাও।`,
          true,
          imageBuffer,
          imageMime
        );
        if (jsonStr) {
          const clean = jsonStr.replace(/```json|```/g, '').trim();
          parsedResult = JSON.parse(clean);
        }
      } catch (geminiErr) {
        console.warn('Gemini Generation Warning, falling back to secondary AI:', geminiErr.message);
      }
    }

    // 2. Secondary AI Engine: Groq LLM (High-Speed Backup)
    if (!parsedResult && !imageBuffer && this.groq) {
      const groqHistory = formattedHistory.map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.content
      }));

      const groqModels = ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
      for (const model of groqModels) {
        try {
          const chatCompletion = await this.groq.chat.completions.create({
            messages: [
              { role: 'system', content: strictSystemInstruction },
              ...groqHistory,
              { role: 'user', content: `কাস্টমারের বর্তমান মেসেজ: "${userMessage}"\nবিগত চ্যাট হিস্ট্রি দেখে প্রাসঙ্গিক ও মানুষের মতো প্রমিত বাংলায় JSON উত্তর দাও।` }
            ],
            model: model,
            temperature: 0.3,
            max_tokens: 1000,
            response_format: { type: 'json_object' }
          });
          const raw = chatCompletion.choices[0]?.message?.content?.trim();
          if (raw) {
            parsedResult = JSON.parse(raw);
            if (parsedResult.replyText || parsedResult.reply) break;
          }
        } catch (err) {
          console.warn(`Groq Model (${model}) Error:`, err.message);
        }
      }
    }

    // 3. Process & Normalize the Generated Result
    let replyText = parsedResult?.replyText || parsedResult?.reply;
    let imageCategory = parsedResult?.imageCategory || null;
    let wantsCall = !!parsedResult?.wantsCall;
    let temperature = parsedResult?.temperature || 'warm';
    let score = parsedResult?.score || 65;
    let orderData = null;

    if (parsedResult?.isOrderConfirmed) {
      orderData = {
        name: parsedResult.customerName || lead.name || customerDisplayName,
        phone: parsedResult.customerPhone || lead.realPhone || lead.phone,
        email: parsedResult.customerEmail || '-',
        pageName: parsedResult.pageName || '-',
        item: parsedResult.packageItem || 'সার্ভিস প্যাকেজ',
        amount: parsedResult.estimatedAmount || 0
      };
      temperature = 'hot';
      score = 95;
    }

    // Check if user specifically requested a phone call
    const lower = userMessage.toLowerCase();
    if (!wantsCall && ['কল দেন', 'কল দিন', 'কথা বলতে চাই', 'ফোন দেন', 'ফোন দিন', 'কল করুন', 'call me', 'call den'].some(k => lower.includes(k))) {
      wantsCall = true;
    }

    // Humanized Fallback (Zero robotic responses)
    if (!replyText) {
      if (wantsCall) {
        replyText = `জ্বি ${customerDisplayName} ভাই, আমি বিষয়টি নোট করে নিয়েছি। কিছুক্ষণের মধ্যেই আমাদের প্রতিনিধি আপনাকে ফোনে কল দিয়ে বিস্তারিত জানিয়ে দেবেন।`;
      } else if (hasPriorDialogue || isExisting) {
        replyText = `জ্বি ${customerDisplayName} ভাই, আপনার মেসেজটি বুঝতে পেরেছি। বলুন আপনাকে আর কীভাবে সাহায্য করতে পারি?`;
      } else {
        replyText = `আসসালামু আলাইকুম ${customerDisplayName} ভাই! ${businessName}-এ আপনাকে স্বাগতম। আমাদের ল্যান্ডিং পেজ, ওয়েবসাইট ডেভেলপমেন্ট বা ডিজিটাল মার্কেটিং সার্ভিস সম্পর্কে কীভাবে সাহায্য করতে পারি বলুন?`;
      }
    }

    return {
      replyText: replyText.trim(),
      imageCategory: (imageCategory === 'hosting' || imageCategory === 'website') ? imageCategory : null,
      wantsCall,
      temperature,
      score,
      orderData,
      isSupportIssue: !!parsedResult?.isSupportIssue,
      isPaymentScreenshot: !!parsedResult?.isPaymentScreenshot,
      paymentAmount: parsedResult?.paymentAmount || null,
      trxId: parsedResult?.trxId || null,
      customerName: parsedResult?.customerName || null,
      customerPhone: parsedResult?.customerPhone || null,
      packageItem: parsedResult?.packageItem || null
    };
  }

  async generateOpeningSpeech(lead) {
    const settings = db.getSettings();
    const agentName = settings.agentName || 'সাদিয়া';
    const businessName = settings.businessName || 'Sohag Online';
    const customerName = lead.name && lead.name !== 'সম্মানিত কাস্টমার' ? lead.name + ' ভাই' : '';

    return `আসসালামু আলাইকুম ${customerName}! আমি ${agentName}, ${businessName} থেকে বলছি। আপনি এইমাত্র আমাদের হোয়াটসঅ্যাপে নক করেছিলেন। আমাদের সার্ভিস সম্পর্কে কি বিস্তারিত জানতে চেয়েছিলেন?`;
  }

  async generateConversationReply(lead, conversationHistory = [], userSpeech = '') {
    this.initProviders();
    const settings = db.getSettings();
    const systemPrompt = this.getCompiledSystemPrompt(lead);

    const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const res = await this.callGemini(geminiKey, `${systemPrompt}\nনির্দেশ: কাস্টমারের কথার সঠিক বিশ্লেষণ করে সর্বোচ্চ ১-২ বাক্যে মিষ্টি ও প্রমিত বাংলায় সঠিক উত্তর দাও। মনগড়া কিছু বলবে না।`, conversationHistory, userSpeech);
      if (res) return res;
    }

    if (this.groq) {
      try {
        const chatCompletion = await this.groq.chat.completions.create({
          messages: [
            { role: 'system', content: `${systemPrompt}\nসর্বোচ্চ ১-২ বাক্যে মিষ্টি বাংলায় উত্তর দাও।` },
            ...conversationHistory,
            { role: 'user', content: userSpeech }
          ],
          model: 'qwen/qwen3.8-27b',
          temperature: 0.35,
          max_tokens: 180
        });
        return chatCompletion.choices[0]?.message?.content?.trim() || 'জ্বি ভাই, আপনি কি আমাদের সার্ভিসটি নিতে আগ্রহী?';
      } catch (err) {
        console.error('Groq Voice Reply Error:', err.message);
      }
    }

    return `জ্বি ভাই, আমরা সর্বোচ্চ মানের সার্ভিস প্রদান করছি। আপনি কি এই বিষয়ে বিস্তারিত জানতে আগ্রহী?`;
  }

  async analyzeCallTranscript(transcript) {
    this.initProviders();
    const settings = db.getSettings();
    const geminiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        const prompt = `Analyze this Bengali customer phone call transcript: "${transcript}".
Return a JSON with "summary" (1-2 sentence Bengali), "interestLevel" (interested/not_interested/call_later/unclear), "notes".`;
        const res = await this.callGemini(geminiKey, "You are an analytical assistant. Output valid JSON only.", [], prompt, true);
        const clean = res.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
          summary: parsed.summary || 'কথোপকথন সম্পন্ন হয়েছে।',
          interestLevel: parsed.interestLevel || 'interested',
          notes: parsed.notes || ''
        };
      } catch (e) {}
    }

    return {
      summary: 'স্বাভাবিক কথোপকথন সম্পন্ন হয়েছে।',
      interestLevel: 'interested',
      notes: ''
    };
  }

  async generatePostCallSummaryMessage(lead, callSummary, interestLevel) {
    const settings = db.getSettings();
    const customerName = lead.name && lead.name !== 'সম্মানিত কাস্টমার' ? lead.name : 'ভাই';
    
    if (interestLevel === 'not_interested') {
      return `ধন্যবাদ ${customerName}! আমাদের সাথে কথা বলার জন্য। ভবিষ্যতে যেকোনো প্রয়োজনে আমরা আপনার পাশে আছি। — ${settings.businessName}`;
    }

    return `আসসালামু আলাইকুম ${customerName}! আপনার সাথে মাত্রই ফোনে কথা হলো।
    
📋 *আমাদের আলোচনার সারসংক্ষেপ:*
${callSummary}

আমাদের সার্ভিস সংক্রান্ত যেকোনো তথ্য বা সাহায্যের জন্য এই হোয়াটসঅ্যাপে যোগাযোগ করতে পারেন। শুভকামনা রইলো!
— ${settings.agentName}, ${settings.businessName}`;
  }
}

module.exports = new AIService();
