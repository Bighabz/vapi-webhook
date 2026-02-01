require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

// Log ALL incoming requests
app.use((req, res, next) => {
  console.log(`📥 ${new Date().toISOString()} ${req.method} ${req.path}`);
  console.log('   Headers:', JSON.stringify(req.headers, null, 2));
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('   Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Twilio setup
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const HABIB_CONTACT = process.env.HABIB_CONTACT || 'Habib at (424) 398-8546';
const CALENDAR_LINK = process.env.CALENDAR_LINK || 'https://calendly.com/your-link';

// In-memory queue for scheduled follow-ups (replace with DB in production)
const followUpQueue = new Map();

// Helper: Send SMS via Twilio
async function sendSMS(to, message) {
  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: FROM_NUMBER,
      to: to
    });
    console.log(`✅ SMS sent to ${to}: ${result.sid}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to send SMS to ${to}:`, error.message);
    throw error;
  }
}

// Handle call-ended event
async function handleCallEnded(vapiPayload, res) {
  // Log the call
  await logCall(vapiPayload);
  
  // Parse call data
  const callInfo = parseCallData(vapiPayload);
  console.log('📊 Parsed call info:', callInfo);
  
  // If no phone number, can't follow up
  if (!callInfo.phone) {
    console.log('⚠️  No phone number found - skipping follow-up');
    return res.json({ success: true, message: 'No phone number to follow up with' });
  }
  
  // Schedule 1-hour follow-up
  const oneHourKey = `${callInfo.callId}-1h`;
  followUpQueue.set(oneHourKey, {
    phone: callInfo.phone,
    message: getOneHourFollowUp(callInfo),
    scheduledFor: Date.now() + (60 * 60 * 1000), // 1 hour
    sent: false
  });
  
  // Schedule 24-hour follow-up
  const oneDayKey = `${callInfo.callId}-24h`;
  followUpQueue.set(oneDayKey, {
    phone: callInfo.phone,
    message: get24HourFollowUp(callInfo),
    scheduledFor: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
    sent: false
  });
  
  // Notify Habib about the call (optional)
  const notifyHabib = process.env.NOTIFY_HABIB_PHONE;
  if (notifyHabib) {
    const summary = `📞 Call Ended\n\nFrom: ${callInfo.phone}${callInfo.name ? `\nName: ${callInfo.name}` : ''}${callInfo.businessType ? `\nBusiness: ${callInfo.businessType}` : ''}\nDuration: ${callInfo.duration}s${callInfo.painPoints.length > 0 ? `\n\nPain points:\n- ${callInfo.painPoints.join('\n- ')}` : ''}\n\n✅ Follow-ups scheduled`;
    
    setTimeout(() => {
      sendSMS(notifyHabib, summary).catch(err => {
        console.error('Failed to notify Habib:', err);
      });
    }, 1000);
  }
  
  return res.json({
    success: true,
    message: 'Follow-ups scheduled',
    scheduledCount: 2
  });
}

// Helper: Log call data
async function logCall(callData) {
  const logDir = path.join(__dirname, 'logs');
  await fs.mkdir(logDir, { recursive: true });
  
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const logFile = path.join(logDir, `call-${timestamp}.json`);
  
  await fs.writeFile(logFile, JSON.stringify(callData, null, 2));
  console.log(`📝 Call logged: ${logFile}`);
}

// Helper: Extract useful info from Vapi call data
function parseCallData(vapiPayload) {
  const transcript = vapiPayload.transcript || '';
  const messages = vapiPayload.messages || [];
  
  // Try to extract caller info from transcript
  let callerName = null;
  let callerPhone = vapiPayload.customer?.number || null;
  let painPoints = [];
  let businessType = null;
  
  // Simple regex to find name mentions
  const nameMatch = transcript.match(/(?:name is|I'm|this is)\s+([A-Z][a-z]+)/i);
  if (nameMatch) callerName = nameMatch[1];
  
  // Extract pain points from user messages
  const userMessages = messages.filter(m => m.role === 'user');
  const fullUserText = userMessages.map(m => m.message).join(' ');
  
  // Look for business type mentions
  const businessTypes = ['barbershop', 'salon', 'restaurant', 'med spa', 'clinic', 'gym', 'shop', 'store'];
  for (const type of businessTypes) {
    if (fullUserText.toLowerCase().includes(type)) {
      businessType = type;
      break;
    }
  }
  
  // Look for pain point keywords
  const painKeywords = {
    'no-show': 'appointment no-shows',
    "don't show": 'appointment no-shows',
    'cancel': 'cancellations',
    'booking': 'booking management',
    'appointment': 'appointment scheduling',
    'customer': 'customer retention',
    'review': 'getting reviews',
    'time': 'time management',
    'phone': 'phone calls',
    'follow up': 'customer follow-up'
  };
  
  for (const [keyword, pain] of Object.entries(painKeywords)) {
    if (fullUserText.toLowerCase().includes(keyword)) {
      painPoints.push(pain);
    }
  }
  
  return {
    name: callerName,
    phone: callerPhone,
    businessType,
    painPoints: [...new Set(painPoints)], // Remove duplicates
    duration: vapiPayload.endedAt && vapiPayload.startedAt 
      ? Math.round((new Date(vapiPayload.endedAt) - new Date(vapiPayload.startedAt)) / 1000)
      : 0,
    transcript,
    callId: vapiPayload.id,
    timestamp: new Date().toISOString()
  };
}

// Follow-up message templates
function getImmediateFollowUp(info) {
  const greeting = info.name ? `Hey ${info.name}!` : 'Hey there!';
  const painMention = info.painPoints.length > 0 
    ? ` I saw you mentioned ${info.painPoints[0]} - definitely something we can help with.`
    : '';
  
  return `${greeting} Thanks for chatting with my AI assistant!${painMention}\n\n📅 Ready to schedule your free consultation? Book here:\n${CALENDAR_LINK}\n\nOr text me directly: ${HABIB_CONTACT}\n\n- Habib`;
}

function getOneHourFollowUp(info) {
  const greeting = info.name ? `${info.name}` : 'Hey';
  return `${greeting}, just following up! Did you get a chance to think about our chat?\n\nIf you want to hop on a quick call to map out a solution for your ${info.businessType || 'business'}, book here: ${CALENDAR_LINK}\n\nNo pressure - just want to make sure you don't lose out on potential revenue while you wait 💰`;
}

function get24HourFollowUp(info) {
  const greeting = info.name ? `Hey ${info.name}` : 'Hey';
  const painMention = info.painPoints.length > 0
    ? ` - especially the ${info.painPoints[0]} issue`
    : '';
  
  return `${greeting}, I know running a ${info.businessType || 'business'} keeps you crazy busy.\n\nIf now isn't the right time${painMention}, no worries. But if you want to see how we could solve this, I'm here.\n\nJust reply "interested" and I'll send over some quick examples from similar businesses.\n\n- Habib`;
}

// General webhook endpoint for all Vapi events
app.post('/vapi/webhook', async (req, res) => {
  console.log('📞 Received webhook from Vapi');
  
  try {
    const vapiPayload = req.body;
    const eventType = vapiPayload.message?.type || 'unknown';
    
    console.log(`   Event type: ${eventType}`);
    
    // Handle call-started event - send SMS immediately
    if (eventType === 'status-update' && vapiPayload.message?.status === 'in-progress') {
      console.log('🚀 Call started - sending immediate SMS with calendar link');
      
      const callerPhone = vapiPayload.call?.customer?.number;
      if (callerPhone) {
        const message = `📅 Hey! While we're chatting, here's my calendar link so you can book your free consultation:\n\n${CALENDAR_LINK}\n\nOr text me directly: ${HABIB_CONTACT}\n\n- Habib`;
        
        // Send immediately (no delay)
        setTimeout(() => {
          sendSMS(callerPhone, message).catch(err => {
            console.error('Failed to send immediate SMS:', err);
          });
        }, 2000); // 2 seconds into call
      }
      
      return res.json({ success: true, message: 'Call started - SMS queued' });
    }
    
    // Handle call-ended event - original follow-up logic
    if (eventType === 'end-of-call-report' || vapiPayload.endedAt) {
      console.log('📞 Call ended - processing follow-up');
      return await handleCallEnded(vapiPayload, res);
    }
    
    // Unknown event type
    console.log('⚠️  Unknown event type, ignoring');
    return res.json({ success: true, message: 'Event received' });
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy endpoint (redirect to new handler)
app.post('/vapi/call-ended', async (req, res) => {
  console.log('📞 Received call-ended webhook from Vapi (legacy endpoint)');
  
  try {
    const vapiPayload = req.body;
    return await handleCallEnded(vapiPayload, res);
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cron job to send scheduled follow-ups (runs every 5 minutes)
cron.schedule('*/5 * * * *', async () => {
  const now = Date.now();
  
  for (const [key, followUp] of followUpQueue.entries()) {
    if (!followUp.sent && now >= followUp.scheduledFor) {
      try {
        await sendSMS(followUp.phone, followUp.message);
        followUp.sent = true;
        console.log(`✅ Sent scheduled follow-up: ${key}`);
        
        // Clean up after 1 hour
        setTimeout(() => followUpQueue.delete(key), 60 * 60 * 1000);
      } catch (error) {
        console.error(`❌ Failed scheduled follow-up ${key}:`, error);
      }
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    queueSize: followUpQueue.size,
    timestamp: new Date().toISOString()
  });
});

// Queue status endpoint
app.get('/queue', (req, res) => {
  const queue = Array.from(followUpQueue.entries()).map(([key, value]) => ({
    id: key,
    phone: value.phone.slice(-4), // Only show last 4 digits for privacy
    scheduledFor: new Date(value.scheduledFor).toISOString(),
    sent: value.sent
  }));
  
  res.json({ queue });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`🚀 Vapi Follow-up Bot listening on port ${PORT}`);
  console.log(`📞 Webhook URL: http://localhost:${PORT}/vapi/call-ended`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});
