// Deprecated in AI-first WhatsApp runtime.
// WhatsApp bots should not depend on hardcoded command maps.
// AI determines user intent from OWNER_KNOWLEDGE, chat context, and the incoming message.

export async function routeMessage() {
  return { handled: false };
}
