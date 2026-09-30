import crypto from "node:crypto";
import { cfg } from "../lib/config.js";
import { normalizeText } from "../lib/normalize.js";
import { clearState, getState, setState } from "../lib/sessionState.js";
import { appendAudit, appendRow, readRows, SHEETS, updateRowByNumber, SheetsNotConfiguredError } from "./googleSheets.js";
import { viewActiveAnnouncementsForAdmin } from "./departmentService.js";

const SHEETS_SETUP_REPLY = "Google Sheets is not connected yet. Please configure the department Google Sheet before using admin actions.";

const ACTIONS = new Map([
  ["add announcement", { type: "add", sheet: "Announcements" }],
  ["update announcement", { type: "update", sheet: "Announcements", key: "AnnouncementID" }],
  ["delete announcement", { type: "archive", sheet: "Announcements", key: "AnnouncementID" }],
  ["view active announcements", { type: "view_announcements" }],
  ["add lecturer", { type: "add", sheet: "Lecturers" }],
  ["update lecturer", { type: "update", sheet: "Lecturers", key: "LecturerID" }],
  ["add course", { type: "add", sheet: "Courses" }],
  ["update timetable", { type: "upsert_timetable", sheet: "Timetable" }],
]);

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function envAdminPhones() {
  return String(cfg.ADMIN_PHONE_NUMBERS || "").split(",").map(digits).filter(Boolean);
}

function codeMatches(plainCode, expectedHash) {
  if (!plainCode || !expectedHash) return false;
  return hash(plainCode) === String(expectedHash).trim().toLowerCase();
}

export function isAdminActionText(text) {
  return ACTIONS.has(normalizeText(text));
}

async function phoneApprovedInSheet(phone) {
  try {
    const rows = await readRows("AdminUsers");
    const p = digits(phone);
    return rows.some((r) => normalizeText(r.Status || "Active") === "active" && digits(r.PhoneNumber) === p);
  } catch {
    return false;
  }
}

export async function userIsVerifiedAdmin({ phone, chatId, userId }) {
  const state = await getState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
  if (state?.adminVerified) return true;

  const p = digits(phone);
  if (envAdminPhones().includes(p) || await phoneApprovedInSheet(phone)) {
    await setState({
      mongoUri: cfg.MONGODB_URI,
      chatId,
      userId,
      state: { ...(state || {}), adminVerified: true, adminPhone: p },
    });
    return true;
  }

  return false;
}

export async function tryVerifyAdminCode({ text, phone, chatId, userId }) {
  const n = normalizeText(text);
  if (!n.startsWith("admin code ")) return "";

  const code = String(text).replace(/^admin\s+code\s+/i, "").trim();
  let ok = false;

  if (cfg.ADMIN_ACCESS_CODE_HASH && codeMatches(code, cfg.ADMIN_ACCESS_CODE_HASH)) ok = true;
  if (cfg.ADMIN_ACCESS_CODE && code === cfg.ADMIN_ACCESS_CODE) ok = true;

  try {
    const rows = await readRows("AdminUsers");
    const p = digits(phone);
    ok = ok || rows.some((r) => {
      return normalizeText(r.Status || "Active") === "active" &&
        (!digits(r.PhoneNumber) || digits(r.PhoneNumber) === p) &&
        codeMatches(code, r.AccessCodeHash);
    });
  } catch {
    // Env-based admin code can still work when the sheet is not connected.
  }

  if (!ok) return "That admin code was not accepted. Please check the code or contact the department representative.";

  const state = await getState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
  await setState({
    mongoUri: cfg.MONGODB_URI,
    chatId,
    userId,
    state: { ...(state || {}), adminVerified: true, adminPhone: digits(phone), lastVerifiedAt: new Date().toISOString() },
  });

  return "Admin access verified. You can now manage approved department information.";
}

function idFieldFor(sheet) {
  if (sheet === "Announcements") return "AnnouncementID";
  if (sheet === "Lecturers") return "LecturerID";
  return "";
}

function makeId(sheet) {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  if (sheet === "Announcements") return "ANN-" + suffix;
  if (sheet === "Lecturers") return "LEC-" + suffix;
  return suffix;
}

function requiredFields(sheet) {
  return SHEETS[sheet].filter((f) => !["Status"].includes(f));
}

async function requireAdmin({ phone, chatId, userId }) {
  if (await userIsVerifiedAdmin({ phone, chatId, userId })) return true;
  return false;
}

async function startWorkflow({ action, phone, chatId, userId }) {
  const fields = action.type === "add" || action.type === "upsert_timetable"
    ? requiredFields(action.sheet).filter((f) => ![idFieldFor(action.sheet)].includes(f))
    : [];

  const workflow = {
    ...action,
    fields,
    values: {},
    index: 0,
    startedAt: new Date().toISOString(),
  };

  await setState({
    mongoUri: cfg.MONGODB_URI,
    chatId,
    userId,
    state: { adminVerified: true, adminPhone: digits(phone), workflow },
  });

  if (action.type === "update") return "Send the " + action.key + " of the record you want to update.";
  if (action.type === "archive") return "Send the " + action.key + " of the announcement you want to archive.";

  return "Okay. Send " + fields[0] + ".\nReply cancel anytime to stop.";
}

export async function handleAdminAction({ text, phone, chatId, userId }) {
  if (!await requireAdmin({ phone, chatId, userId })) {
    return "Admin access is required. If you are approved department staff, send: admin code YOUR_CODE";
  }

  const action = ACTIONS.get(normalizeText(text));
  if (!action) return "Please send a supported admin action, such as Add announcement or View active announcements.";

  try {
    if (action.type === "view_announcements") return await viewActiveAnnouncementsForAdmin();
    return await startWorkflow({ action, phone, chatId, userId });
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) return SHEETS_SETUP_REPLY;
    throw err;
  }
}

function validField(sheet, field) {
  const n = normalizeText(field).replace(/\s+/g, "");
  return SHEETS[sheet].find((f) => normalizeText(f).replace(/\s+/g, "") === n) || "";
}

async function findByKey(sheet, key, value) {
  const rows = await readRows(sheet, { useCache: false });
  return rows.find((r) => normalizeText(r[key]) === normalizeText(value)) || null;
}

async function upsertTimetable(values, adminPhone) {
  const rows = await readRows("Timetable", { useCache: false });
  const found = rows.find((r) => {
    return normalizeText(r.Level) === normalizeText(values.Level) &&
      normalizeText(r.CourseCode) === normalizeText(values.CourseCode) &&
      normalizeText(r.Day) === normalizeText(values.Day);
  });

  const next = { ...values, Status: values.Status || "Active" };

  if (found) {
    const updated = { ...found, ...next };
    delete updated._rowNumber;
    await updateRowByNumber("Timetable", found._rowNumber, updated);
    await appendAudit({ adminPhone, action: "Update timetable", sheetName: "Timetable", recordId: values.CourseCode, beforeValue: found, afterValue: updated, result: "Updated" });
    return "Timetable entry updated.";
  }

  await appendRow("Timetable", next);
  await appendAudit({ adminPhone, action: "Add timetable", sheetName: "Timetable", recordId: values.CourseCode, afterValue: next, result: "Added" });
  return "Timetable entry added.";
}

export async function continueAdminWorkflow({ text, phone, chatId, userId, state }) {
  const n = normalizeText(text);
  if (n === "cancel" || n === "stop") {
    await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
    return "Admin workflow cancelled.";
  }

  const workflow = state.workflow;
  if (!workflow) return "No active admin workflow.";

  try {
    if (workflow.type === "add" || workflow.type === "upsert_timetable") {
      const field = workflow.fields[workflow.index];
      workflow.values[field] = n === "skip" ? "" : String(text).trim();
      workflow.index += 1;

      if (workflow.index < workflow.fields.length) {
        await setState({ mongoUri: cfg.MONGODB_URI, chatId, userId, state: { ...state, workflow } });
        return "Send " + workflow.fields[workflow.index] + ".\nReply skip if not applicable, or cancel to stop.";
      }

      if (workflow.type === "upsert_timetable") {
        const msg = await upsertTimetable(workflow.values, digits(phone));
        await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
        return msg;
      }

      const idField = idFieldFor(workflow.sheet);
      const row = { ...workflow.values, Status: workflow.values.Status || "Active" };
      if (idField) row[idField] = makeId(workflow.sheet);
      await appendRow(workflow.sheet, row);
      await appendAudit({ adminPhone: digits(phone), action: "Add", sheetName: workflow.sheet, recordId: row[idField] || row.CourseCode || "", afterValue: row, result: "Added" });
      await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
      return workflow.sheet + " record saved" + (idField ? " with ID " + row[idField] : "") + ".";
    }

    if (workflow.type === "update") {
      if (!workflow.recordId) {
        workflow.recordId = String(text).trim();
        await setState({ mongoUri: cfg.MONGODB_URI, chatId, userId, state: { ...state, workflow } });
        return "Which field should I update? Example: Title, Message, OfficeLocation, PhoneNumber, Email, CoursesTaught, OfficeHours, Bio, PhotoURL, or Status.";
      }

      if (!workflow.field) {
        const field = validField(workflow.sheet, text);
        if (!field) return "That field is not valid for " + workflow.sheet + ". Please send a valid field name.";
        workflow.field = field;
        await setState({ mongoUri: cfg.MONGODB_URI, chatId, userId, state: { ...state, workflow } });
        return "Send the new value for " + field + ".";
      }

      const found = await findByKey(workflow.sheet, workflow.key, workflow.recordId);
      if (!found) {
        await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
        return "I could not find that record ID in " + workflow.sheet + ".";
      }

      const updated = { ...found, [workflow.field]: String(text).trim() };
      delete updated._rowNumber;
      await updateRowByNumber(workflow.sheet, found._rowNumber, updated);
      await appendAudit({ adminPhone: digits(phone), action: "Update", sheetName: workflow.sheet, recordId: workflow.recordId, beforeValue: found, afterValue: updated, result: "Updated" });
      await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
      return workflow.sheet + " record updated.";
    }

    if (workflow.type === "archive") {
      const found = await findByKey(workflow.sheet, workflow.key, text);
      if (!found) {
        await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
        return "I could not find that announcement ID.";
      }

      const updated = { ...found, Status: "Archived" };
      delete updated._rowNumber;
      await updateRowByNumber(workflow.sheet, found._rowNumber, updated);
      await appendAudit({ adminPhone: digits(phone), action: "Archive", sheetName: workflow.sheet, recordId: String(text).trim(), beforeValue: found, afterValue: updated, result: "Archived" });
      await clearState({ mongoUri: cfg.MONGODB_URI, chatId, userId });
      return "Announcement archived.";
    }

    return "I could not continue that admin workflow. Send cancel and try again.";
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) return SHEETS_SETUP_REPLY;
    throw err;
  }
}
