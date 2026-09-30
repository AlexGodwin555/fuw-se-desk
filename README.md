# WhatsApp Support Bot

This is a CookMyBots managed WhatsApp AI representative.

## Important

This project is the bot brain only. CookMyBots owns the WhatsApp connection/session and forwards inbound WhatsApp messages to this deployed app.

This bot does not use a fixed Telegram-style command system.

Instead:

- the owner prompt is stored as raw knowledge
- AI reads that knowledge
- AI determines what the bot represents
- AI determines whether it is for a community, business, project, support desk, school, creator, group, event, or something else
- AI determines the user intent
- AI replies naturally in WhatsApp DMs and groups

## Transport endpoint

CookMyBots calls:

```txt
POST /webhook/cookmybots/whatsapp
```

The endpoint returns:

```json
{ "ok": true, "reply": "..." }
```

## Required AI config

```env
COOKMYBOTS_AI_ENDPOINT=
COOKMYBOTS_AI_KEY=
```

## Local test

```bash
npm install
cp .env.sample .env
npm run dev
```

Then:

```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"text":"Who are you and what can you help with?"}'
```
