const log = {
  info:  (...a) => console.log(...a),
  warn:  (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

import { normalizeText } from "../lib/normalize.js";
import { readRows, SheetsNotConfiguredError } from "./googleSheets.js";

export const MISSING_INFO_REPLY = "I don’t have confirmed information on that yet. Please check back later or contact the Department of Software Engineering representative.";
const SHEETS_SETUP_REPLY = "Google Sheets is not connected yet. Please ask the owner to configure the department Google Sheet before I can answer confirmed department questions.";

function isActive(row) {
  return normalizeText(row.Status || "Active") === "active";
}

function isCurrentAnnouncement(row) {
  if (!isActive(row)) return false;
  if (!row.ExpiryDate) return true;
  const d = new Date(row.ExpiryDate);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() >= Date.now();
}

function priorityScore(value) {
  const v = normalizeText(value);
  if (v === "high" || v === "urgent") return 3;
  if (v === "medium") return 2;
  if (v === "low") return 1;
  return 0;
}

function dateScore(value) {
  const d = new Date(value || "");
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function extractLevel(text, intent = {}) {
  if (intent.level) return String(intent.level).replace(/[^0-9]/g, "");
  const match = String(text || "").match(/\b([1-5]00)\s*(level|lvl)?\b/i);
  return match ? match[1] : "";
}

function extractCourseCode(text, intent = {}) {
  if (intent.courseCode) return String(intent.courseCode).toUpperCase().replace(/\s+/g, " ").trim();
  const match = String(text || "").match(/\b[A-Z]{2,4}\s*\d{3}\b/i);
  return match ? match[0].toUpperCase().replace(/\s+/g, " ") : "";
}

function cleanPersonName(value) {
  return normalizeText(value)
    .replace(/\b(dr|prof|mr|mrs|miss|ms|engineer|engr)\b\.?/g, "")
    .replace(/\b(details|detail|picture|photo|office|teaches|teach|courses|course|send|show|me|who|is|where|what)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lecturerQuery(text, intent = {}) {
  if (intent.lecturerName) return cleanPersonName(intent.lecturerName);
  return cleanPersonName(text);
}

function matchText(row, fields, query) {
  const q = normalizeText(query);
  if (!q) return false;
  return fields.some((f) => normalizeText(row[f]).includes(q) || q.includes(normalizeText(row[f])));
}

function formatAnnouncement(row, includeId = false) {
  const parts = [];
  if (includeId && row.AnnouncementID) parts.push("ID: " + row.AnnouncementID);
  if (row.Title) parts.push(row.Title);
  if (row.Message) parts.push(row.Message);
  const meta = [row.Level ? row.Level + " level" : "", row.CourseCode, row.DatePosted ? "Posted: " + row.DatePosted : ""].filter(Boolean).join(" | ");
  if (meta) parts.push(meta);
  return parts.join("\n");
}

function formatLecturer(row, photoOnly = false) {
  if (photoOnly) {
    if (row.PhotoURL) {
      log.info("media fallback", { platform: "whatsapp", feature: "lecturer_photo", fallback: "photo_url" });
      return "Approved lecturer photo link for " + (row.FullName || "the lecturer") + ":\n" + row.PhotoURL;
    }
    return MISSING_INFO_REPLY;
  }

  const lines = [];
  if (row.FullName || row.Title) lines.push([row.Title, row.FullName].filter(Boolean).join(" "));
  if (row.DepartmentRole) lines.push("Role: " + row.DepartmentRole);
  if (row.OfficeLocation) lines.push("Office: " + row.OfficeLocation);
  if (row.PhoneNumber) lines.push("Phone: " + row.PhoneNumber);
  if (row.Email) lines.push("Email: " + row.Email);
  if (row.CoursesTaught) lines.push("Courses: " + row.CoursesTaught);
  if (row.OfficeHours) lines.push("Office hours: " + row.OfficeHours);
  if (row.Bio) lines.push("Bio: " + row.Bio);
  if (row.PhotoURL) lines.push("Photo: " + row.PhotoURL);
  return lines.join("\n") || MISSING_INFO_REPLY;
}

function daySort(row) {
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  return days.indexOf(normalizeText(row.Day));
}

async function latestAnnouncements(level = "") {
  const rows = (await readRows("Announcements")).filter(isCurrentAnnouncement);
  const filtered = level
    ? rows.filter((r) => !r.Level || normalizeText(r.Level) === normalizeText(level) || normalizeText(r.Level) === "all")
    : rows;

  filtered.sort((a, b) => priorityScore(b.Priority) - priorityScore(a.Priority) || dateScore(b.DatePosted) - dateScore(a.DatePosted));
  return filtered.slice(0, 3);
}

async function findLecturer(text, intent = {}) {
  const query = lecturerQuery(text, intent);
  const rows = (await readRows("Lecturers")).filter(isActive);
  if (!query) return null;

  return rows.find((r) => matchText(r, ["FullName", "Title", "CoursesTaught", "DepartmentRole"], query)) || null;
}

async function handleCourseLecturer(text, intent) {
  const code = extractCourseCode(text, intent);
  if (!code) return MISSING_INFO_REPLY;

  const courses = (await readRows("Courses")).filter(isActive);
  const course = courses.find((r) => normalizeText(r.CourseCode) === normalizeText(code));
  if (!course) return MISSING_INFO_REPLY;

  const lines = [];
  lines.push((course.CourseCode || code) + (course.CourseTitle ? " - " + course.CourseTitle : ""));
  if (course.LecturerName) lines.push("Lecturer: " + course.LecturerName);
  if (course.Venue) lines.push("Venue: " + course.Venue);
  if (course.Schedule) lines.push("Schedule: " + course.Schedule);
  if (course.Semester) lines.push("Semester: " + course.Semester);
  return lines.join("\n") || MISSING_INFO_REPLY;
}

async function handleTimetable(text, intent) {
  const level = extractLevel(text, intent);
  if (!level) return MISSING_INFO_REPLY;

  const rows = (await readRows("Timetable")).filter((r) => isActive(r) && normalizeText(r.Level) === normalizeText(level));
  if (!rows.length) return MISSING_INFO_REPLY;

  rows.sort((a, b) => daySort(a) - daySort(b) || normalizeText(a.Time).localeCompare(normalizeText(b.Time)));
  return rows.slice(0, 12).map((r) => {
    return [r.Day, r.Time, r.CourseCode, r.CourseTitle, r.Venue, r.LecturerName].filter(Boolean).join(" | ");
  }).join("\n");
}

async function handleInfo(type, text, intent = {}) {
  const rows = (await readRows("DepartmentInfo")).filter(isActive);
  const q = normalizeText(intent.infoType || type || text);
  const found = rows.find((r) => {
    const hay = normalizeText([r.InfoType, r.Title, r.Details].join(" "));
    if (q.includes("fee")) return hay.includes("fee") || hay.includes("payment") || hay.includes("dues");
    if (q.includes("contact")) return hay.includes("contact") || r.ContactPerson || r.ContactPhone;
    return hay.includes(q) || q.includes(normalizeText(r.InfoType)) || q.includes(normalizeText(r.Title));
  });

  if (!found) return MISSING_INFO_REPLY;

  const lines = [];
  if (found.Title) lines.push(found.Title);
  if (found.Details) lines.push(found.Details);
  if (found.ContactPerson) lines.push("Contact: " + found.ContactPerson);
  if (found.ContactPhone) lines.push("Phone: " + found.ContactPhone);
  if (found.LastUpdated) lines.push("Last updated: " + found.LastUpdated);
  return lines.join("\n") || MISSING_INFO_REPLY;
}

export async function handleStudentIntent({ intent = {}, text }) {
  try {
    const name = normalizeText(intent.intent || "unknown");

    if (name === "intro") {
      const { OFFICIAL_INTRO } = await import("../lib/botProfile.js");
      return OFFICIAL_INTRO;
    }

    if (name === "latest_announcement") {
      const rows = await latestAnnouncements();
      return rows.length ? rows.map((r) => formatAnnouncement(r)).join("\n\n") : MISSING_INFO_REPLY;
    }

    if (name === "level_announcements") {
      const level = extractLevel(text, intent);
      const rows = await latestAnnouncements(level);
      return rows.length ? rows.map((r) => formatAnnouncement(r)).join("\n\n") : MISSING_INFO_REPLY;
    }

    if (name === "course_lecturer") return await handleCourseLecturer(text, intent);

    if (name === "lecturer_details") {
      const row = await findLecturer(text, intent);
      return row ? formatLecturer(row) : MISSING_INFO_REPLY;
    }

    if (name === "lecturer_photo") {
      const row = await findLecturer(text, intent);
      return row ? formatLecturer(row, true) : MISSING_INFO_REPLY;
    }

    if (name === "level_timetable") return await handleTimetable(text, intent);
    if (name === "department_fee") return await handleInfo("fee", text, intent);
    if (name === "department_contact") return await handleInfo("contact", text, intent);
    if (name === "general_info") return await handleInfo("general", text, intent);

    return MISSING_INFO_REPLY;
  } catch (err) {
    if (err instanceof SheetsNotConfiguredError) return SHEETS_SETUP_REPLY;
    throw err;
  }
}

export async function viewActiveAnnouncementsForAdmin() {
  const rows = (await readRows("Announcements", { useCache: false })).filter(isCurrentAnnouncement);
  rows.sort((a, b) => priorityScore(b.Priority) - priorityScore(a.Priority) || dateScore(b.DatePosted) - dateScore(a.DatePosted));
  return rows.length ? rows.slice(0, 20).map((r) => formatAnnouncement(r, true)).join("\n\n") : "No active announcements found.";
}
