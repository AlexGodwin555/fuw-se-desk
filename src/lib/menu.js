// Deprecated in AI-first WhatsApp runtime.
// WhatsApp bots should not depend on hardcoded menus.
// AI determines the useful response from OWNER_KNOWLEDGE at runtime.

export function deprecatedMenuNotice() {
  return "This WhatsApp representative uses AI-first natural conversation instead of a fixed menu.";
}
