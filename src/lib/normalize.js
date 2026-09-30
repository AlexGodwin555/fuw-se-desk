export function cleanText(value) {
  return String(value || "").trim();
}

export function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/^[\/!#.]+/, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[!?.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampWhatsAppText(value, max = 4000) {
  return cleanText(value).slice(0, max);
}
