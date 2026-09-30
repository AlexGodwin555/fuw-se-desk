import "dotenv/config";
import express from "express";
import { cfg } from "./lib/config.js";
import { handleText } from "./brain.js";

process.on("unhandledRejection", (err) => {
  console.error("UnhandledRejection:", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err?.message || err);
});

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.status(200).send("OK"));
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    platform: "whatsapp",
    managedTransport: true,
  });
});

function normalizeInbound(body = {}) {
  const from = String(body.from || body.chatId || "anon").trim();
  const chatId = String(body.chatId || body.from || from || "anon").trim();
  const senderId = String(body.senderId || body.participantJid || body.participant || body.from || from || "anon").trim();

  return {
    projectId: String(body.projectId || "").trim(),
    platform: "whatsapp",
    source: String(body.source || "session").trim(),

    from,
    chatId,
    senderId,
    participantJid: String(body.participantJid || body.participant || "").trim(),

    userId: senderId || from || "anon",
    text: String(body.text || "").trim(),
    messageId: String(body.messageId || "").trim(),

    isGroup: Boolean(body.isGroup || String(chatId).endsWith("@g.us")),
    groupId: body.groupId ? String(body.groupId) : String(chatId).endsWith("@g.us") ? chatId : null,
    pushName: body.pushName ? String(body.pushName) : "",
    messageType: body.messageType ? String(body.messageType) : "text",
    timestamp: Number(body.timestamp || Date.now()),
    raw: body,
  };
}

app.post("/webhook/cookmybots/whatsapp", async (req, res) => {
  try {
    const expected = String(cfg.CMB_WHATSAPP_WEBHOOK_SECRET || "").trim();
    const got = String(req.headers["x-cookmybots-webhook-secret"] || "").trim();

    if (!expected || got !== expected) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const event = normalizeInbound(req.body || {});
    if (!event.text) return res.status(400).json({ ok: false, error: "missing_text" });

    const reply = await handleText(event);

    return res.json({
      ok: true,
      reply: String(reply || "Received.").slice(0, 4000),
    });
  } catch (err) {
    console.error("WhatsApp webhook failed:", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: "server_error",
      reply: "Received.",
    });
  }
});

app.post("/test", async (req, res) => {
  try {
    const event = normalizeInbound({
      ...req.body,
      from: "local@s.whatsapp.net",
      chatId: req.body?.chatId || "local@s.whatsapp.net",
      senderId: "local@s.whatsapp.net",
      source: "local",
    });

    if (!event.text) return res.status(400).json({ ok: false, error: "missing_text" });

    const reply = await handleText(event);
    return res.json({ ok: true, reply });
  } catch (err) {
    console.error("Local test failed:", err?.message || err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

const port = Number(cfg.PORT || 3000);
app.listen(port, () => {
  console.log("CookMyBots managed WhatsApp bot listening on :" + port);
});
