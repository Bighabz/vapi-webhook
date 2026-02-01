# Vapi Webhook Server

Automated SMS follow-up system for Vapi voice calls.

## Deploy to Railway (2 clicks!)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/tFlTNk?referralCode=XXsoT9)

## Manual Setup

1. Click the Railway button above
2. Fork this repo to your GitHub
3. Connect Railway to the fork
4. Add environment variables in Railway:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER`
   - `NOTIFY_HABIB_PHONE`
   - `HABIB_CONTACT`
   - `CALENDAR_LINK`
   - `PORT=8080`

5. Deploy!
6. Copy your Railway URL (e.g., `https://yourproject.up.railway.app`)
7. Update Vapi assistant webhook to: `https://yourproject.up.railway.app/vapi/webhook`

## Environment Variables

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_PHONE_NUMBER=+1234567890

# Notification Settings
NOTIFY_HABIB_PHONE=+13109515542
HABIB_CONTACT=Habib at (424) 398-8546
CALENDAR_LINK=https://calendly.com/habibjahshan2026

# Server Configuration  
PORT=8080
```

## Features

- ✅ Instant SMS with calendar link during call
- ✅ 1-hour follow-up with pain point mention
- ✅ 24-hour gentle nudge
- ✅ Call logging
- ✅ Webhook verification

## Endpoints

- `POST /vapi/webhook` - Main webhook for all Vapi events
- `GET /health` - Health check

