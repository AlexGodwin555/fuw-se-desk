import { cfg } from "./config.js";

export async function sendWhatsAppText({ to, text }) {
  const base = String(cfg.CMB_WHATSAPP_TRANSPORT_ENDPOINT || "").replace(/\/+$/, "");
  const key = String(cfg.CMB_WHATSAPP_TRANSPORT_KEY || "").trim();

  if (!base || !key) {
    throw new Error("CookMyBots WhatsApp proactive transport is not configured for this bot yet.");
  }

  const r = await fetch(base + "/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify({
      to,
      text: String(text || "").slice(0, 4000),
    }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error("WhatsApp transport send failed: " + r.status + " " + body);
  }

  return r.json().catch(() => ({ ok: true }));
}
