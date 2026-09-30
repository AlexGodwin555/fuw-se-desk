import { google } from "googleapis";
import { cfg } from "../lib/config.js";
import { log, safeErr } from "../lib/log.js";

export const SHEETS = {
  Announcements: ["AnnouncementID", "Title", "Category", "Level", "CourseCode", "Message", "DatePosted", "ExpiryDate", "Priority", "Status"],
  Lecturers: ["LecturerID", "FullName", "Title", "DepartmentRole", "OfficeLocation", "PhoneNumber", "Email", "CoursesTaught", "OfficeHours", "Bio", "PhotoURL", "Status"],
  Courses: ["CourseCode", "CourseTitle", "Level", "Semester", "LecturerName", "Venue", "Schedule", "Description", "Status"],
  Timetable: ["Level", "CourseCode", "CourseTitle", "Day", "Time", "Venue", "LecturerName", "Status"],
  DepartmentInfo: ["InfoType", "Title", "Details", "ContactPerson", "ContactPhone", "LastUpdated", "Status"],
  AdminUsers: ["PhoneNumber", "FullName", "Role", "AccessCodeHash", "Status", "LastVerifiedAt"],
  AuditLog: ["Timestamp", "AdminPhone", "Action", "SheetName", "RecordID", "BeforeValue", "AfterValue", "Result"],
};

const cache = new Map();
let sheetsClient = null;
let workbookReady = false;

export class SheetsNotConfiguredError extends Error {
  constructor() {
    super("Google Sheets is not configured");
  }
}

export function googleSheetsConfigured() {
  return Boolean(
    cfg.GOOGLE_SHEETS_SPREADSHEET_ID &&
      cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      (cfg.GOOGLE_PRIVATE_KEY || cfg.GOOGLE_PRIVATE_KEY_BASE64)
  );
}

function privateKey() {
  if (cfg.GOOGLE_PRIVATE_KEY_BASE64) {
    return Buffer.from(cfg.GOOGLE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  return String(cfg.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

async function getSheetsClient() {
  if (!googleSheetsConfigured()) throw new SheetsNotConfiguredError();
  if (sheetsClient) return sheetsClient;

  const auth = new google.auth.JWT({
    email: cfg.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: privateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

function quoteSheet(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

export function clearSheetCache(sheetName = "") {
  if (sheetName) cache.delete(sheetName);
  else cache.clear();
}

export async function ensureWorkbook() {
  if (workbookReady) return;

  const client = await getSheetsClient();
  const spreadsheetId = cfg.GOOGLE_SHEETS_SPREADSHEET_ID;

  try {
    const meta = await client.spreadsheets.get({ spreadsheetId });
    const existing = new Set((meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean));

    const requests = [];
    for (const name of Object.keys(SHEETS)) {
      if (!existing.has(name)) requests.push({ addSheet: { properties: { title: name } } });
    }

    if (requests.length) {
      await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
      log.info("google sheets created missing tabs", { count: requests.length });
    }

    for (const [name, headers] of Object.entries(SHEETS)) {
      await client.spreadsheets.values.update({
        spreadsheetId,
        range: quoteSheet(name) + "!A1:" + String.fromCharCode(64 + headers.length) + "1",
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }

    workbookReady = true;
  } catch (err) {
    log.error("google sheets ensure failed", { err: safeErr(err) });
    throw err;
  }
}

export async function readRows(sheetName, { useCache = true } = {}) {
  const ttl = Number(cfg.GOOGLE_SHEETS_CACHE_TTL_MS || 30000);
  const cached = cache.get(sheetName);
  if (useCache && cached && Date.now() - cached.at < ttl) return cached.rows;

  const client = await getSheetsClient();
  await ensureWorkbook();

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: quoteSheet(sheetName) + "!A:Z",
    });

    const values = res.data.values || [];
    const headers = values[0] || SHEETS[sheetName] || [];
    const rows = values.slice(1).map((line, index) => {
      const row = { _rowNumber: index + 2 };
      headers.forEach((h, i) => {
        row[h] = String(line[i] || "").trim();
      });
      return row;
    });

    cache.set(sheetName, { rows, at: Date.now() });
    return rows;
  } catch (err) {
    log.error("google sheets read failed", { sheetName, err: safeErr(err) });
    throw err;
  }
}

export async function appendRow(sheetName, row) {
  const client = await getSheetsClient();
  await ensureWorkbook();
  const headers = SHEETS[sheetName];
  const values = headers.map((h) => String(row[h] || ""));

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: quoteSheet(sheetName) + "!A:Z",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [values] },
    });
    clearSheetCache(sheetName);
  } catch (err) {
    log.error("google sheets append failed", { sheetName, err: safeErr(err) });
    throw err;
  }
}

export async function updateRowByNumber(sheetName, rowNumber, row) {
  const client = await getSheetsClient();
  await ensureWorkbook();
  const headers = SHEETS[sheetName];
  const values = headers.map((h) => String(row[h] || ""));

  try {
    await client.spreadsheets.values.update({
      spreadsheetId: cfg.GOOGLE_SHEETS_SPREADSHEET_ID,
      range: quoteSheet(sheetName) + "!A" + rowNumber + ":" + String.fromCharCode(64 + headers.length) + rowNumber,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [values] },
    });
    clearSheetCache(sheetName);
  } catch (err) {
    log.error("google sheets update failed", { sheetName, rowNumber, err: safeErr(err) });
    throw err;
  }
}

export async function appendAudit({ adminPhone, action, sheetName, recordId, beforeValue, afterValue, result }) {
  try {
    await appendRow("AuditLog", {
      Timestamp: new Date().toISOString(),
      AdminPhone: adminPhone,
      Action: action,
      SheetName: sheetName,
      RecordID: recordId,
      BeforeValue: JSON.stringify(beforeValue || {}).slice(0, 2000),
      AfterValue: JSON.stringify(afterValue || {}).slice(0, 2000),
      Result: result || "OK",
    });
  } catch (err) {
    log.error("google sheets audit failed", { sheetName: "AuditLog", err: safeErr(err) });
  }
}
