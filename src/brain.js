import { cfg } from "./lib/config.js";
import { addTurn, getRecentTurns } from "./lib/memory.js";
import { aiSmartChat } from "./lib/ai.js";
import { BOT_SYSTEM_PROMPT, OWNER_KNOWLEDGE } from "./lib/botProfile.js";

export async function handleText(event) {
  const uid = String(event.userId || event.senderId || event.from || "anon");
  const cid = String(event.chatId || event.from || uid);
  const text = String(event.text || "").trim();

  await addTurn({
    mongoUri: cfg.MONGODB_URI,
    platform: "whatsapp",
    userId: uid,
    chatId: cid,
    role: "user",
    text,
    meta: {
      isGroup: Boolean(event.isGroup),
      groupId: event.groupId || null,
      messageId: event.messageId || "",
      source: event.source || "session",
      pushName: event.pushName || "",
      messageType: event.messageType || "text",
    },
  });

  const history = await getRecentTurns({
    mongoUri: cfg.MONGODB_URI,
    platform: "whatsapp",
    userId: uid,
    chatId: cid,
    limit: 14,
  });

  const contextPrompt = [
    BOT_SYSTEM_PROMPT,
    "",
    "Current WhatsApp context:",
    "- chatId: " + cid,
    "- senderId: " + uid,
    "- isGroup: " + Boolean(event.isGroup),
    "- groupId: " + String(event.groupId || "none"),
    "- pushName: " + String(event.pushName || "unknown"),
    "- messageType: " + String(event.messageType || "text"),
    "",
    "Runtime instructions:",
    "- Use AI to understand what role this bot should play from OWNER_KNOWLEDGE.",
    "- Use AI to understand what the user wants.",
    "- Use AI to determine whether the message is a question, command-like request, moderation request, community inquiry, support request, business inquiry, onboarding request, complaint, greeting, announcement request, or something else.",
    "- Do not rely on fixed command maps.",
    "- Do not ask the user to type a fixed menu command unless OWNER_KNOWLEDGE specifically describes such a flow.",
    "- Do not assume this is a sales bot.",
    "- Do not assume this is a community moderation bot.",
    "- Do not assume this is a support bot.",
    "- Let OWNER_KNOWLEDGE decide the bot purpose.",
    "- If OWNER_KNOWLEDGE contains the requested answer, answer from it.",
    "- If OWNER_KNOWLEDGE does not contain the requested detail, say the owner has not provided that detail yet.",
    "- Do not invent products, prices, contacts, addresses, payment details, delivery details, group rules, announcements, policies, availability, admin names, guarantees, or FAQs.",
    "- If the user asks who you are, explain that you are the WhatsApp AI representative for the entity described in OWNER_KNOWLEDGE.",
    "- If the user asks what you can do, infer useful capabilities from OWNER_KNOWLEDGE rather than listing hardcoded commands.",
    "- If this is a group chat, keep the reply shorter and avoid spam.",
    "- The CookMyBots WhatsApp transport should only send group messages to you when the bot was mentioned, replied to, or explicitly allowed by group reply settings.",
    "- Do not encourage replying to every group message.",
    "- If this is a private DM, guide the user to the next useful step.",
    "- Never identify as a generic ChatGPT assistant.",
    "- Never give Telegram, Discord, Slack, or Teams bot setup instructions.",
    "",
    "OWNER_KNOWLEDGE availability: " + (OWNER_KNOWLEDGE ? "provided" : "empty"),
  ].join("\n");

  const reply = await aiSmartChat({
    systemPrompt: contextPrompt,
    userText: text,
    history,
    platform: "whatsapp",
    userId: uid,
    chatId: cid,
  });

  const out = String(reply || "").trim() || "I could not generate a reply right now.";

  await addTurn({
    mongoUri: cfg.MONGODB_URI,
    platform: "whatsapp",
    userId: uid,
    chatId: cid,
    role: "assistant",
    text: out,
  });

  return out;
}
