import express from "express";
import { cfg } from "./lib/config.js";
import { log, safeErr } from "./lib/log.js";
import { handleText } from "./brain.js";
import { closeDb } from "./lib/db.js";

function normalizeInbound(body = {}) {
  const from = String(body.from || body.chatId || "anon").trim();
  const chatId = String(body.chatId || body.from || from || "anon").trim();
  const senderId = String(body.senderId || body.participantJid || body.participant || body.from || from || "anon").trim();

  return {
    projectId: String(body.projectId || "").trim(),
    platform: "whatsapp",
    source: String(body.source || "managed_whatsapp").trim(),
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

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.status(200).send("Wukari SE WhatsApp Bot OK");
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      platform: "whatsapp",
      managedTransport: true,
      aiConfigured: Boolean(cfg.COOKMYBOTS_AI_ENDPOINT && cfg.COOKMYBOTS_AI_KEY),
      googleSheetsConfigured: Boolean(
        cfg.GOOGLE_SHEETS_SPREADSHEET_ID &&
          cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
          (cfg.GOOGLE_PRIVATE_KEY || cfg.GOOGLE_PRIVATE_KEY_BASE64)
      ),
      mongoConfigured: Boolean(cfg.MONGODB_URI),
    });
  });

  app.post("/webhook/cookmybots/whatsapp", async (req, res) => {
    const startedAt = Date.now();

    try {
      const expected = String(cfg.CMB_WHATSAPP_WEBHOOK_SECRET || "").trim();
      const got = String(req.headers["x-cookmybots-webhook-secret"] || "").trim();

      if (!expected || got !== expected) {
        log.warn("webhook unauthorized", {
          platform: "whatsapp",
          secretConfigured: Boolean(expected),
        });
        return res.status(401).json({ ok: false, error: "unauthorized" });
      }

      const event = normalizeInbound(req.body || {});
      if (!event.text) {
        return res.status(400).json({ ok: false, error: "missing_text" });
      }

      const reply = await handleText(event);

      log.info("webhook handled", {
        platform: "whatsapp",
        messageType: event.messageType,
        isGroup: event.isGroup,
        ms: Date.now() - startedAt,
      });

      return res.json({
        ok: true,
        reply: String(reply || "Received.").slice(0, 4000),
      });
    } catch (err) {
      log.error("webhook failed", {
        platform: "whatsapp",
        err: safeErr(err),
        ms: Date.now() - startedAt,
      });

      return res.status(500).json({
        ok: false,
        error: "server_error",
        reply: "I could not process that message right now. Please try again shortly.",
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
        source: "local_test",
      });

      if (!event.text) return res.status(400).json({ ok: false, error: "missing_text" });

      const reply = await handleText(event);
      return res.json({ ok: true, reply });
    } catch (err) {
      log.error("local test failed", { err: safeErr(err) });
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  return app;
}

export async function startServer() {
  const app = createApp();
  const port = Number(cfg.PORT || 3000);

  const server = app.listen(port, () => {
    log.info("server listening", {
      platform: "whatsapp",
      port,
      endpoint: "/webhook/cookmybots/whatsapp",
    });
  });

  const memoryLog = setInterval(() => {
    const m = process.memoryUsage();
    log.info("memory", {
      rssMB: Math.round(m.rss / 1e6),
      heapUsedMB: Math.round(m.heapUsed / 1e6),
    });
  }, 60_000);
  memoryLog.unref();

  async function shutdown(signal) {
    log.info("shutdown start", { signal });
    clearInterval(memoryLog);
    server.close(async () => {
      await closeDb();
      log.info("shutdown complete", { signal });
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
