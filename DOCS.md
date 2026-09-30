# Wukari SE Desk Bot

This is a WhatsApp-only private chat assistant for the Department of Software Engineering, Faculty of Computing and Information Systems, Federal University Wukari.

CookMyBots manages the WhatsApp connection. This project is only the bot brain exposed at:

POST /webhook/cookmybots/whatsapp

The bot does not use Telegram, Telegram tokens, Telegram commands, Telegram usernames, or Telegram deployment paths.

## What the bot does

The bot answers students from approved Google Sheets records only. It can help with department announcements, lecturer information, courses, timetables, fees, deadlines, venues, and approved department contact information.

If confirmed data is not found, it replies:

I don’t have confirmed information on that yet. Please check back later or contact the Department of Software Engineering representative.

## Google Sheets tables

The bot creates or connects these tabs in the configured spreadsheet:

1) Announcements: AnnouncementID, Title, Category, Level, CourseCode, Message, DatePosted, ExpiryDate, Priority, Status
2) Lecturers: LecturerID, FullName, Title, DepartmentRole, OfficeLocation, PhoneNumber, Email, CoursesTaught, OfficeHours, Bio, PhotoURL, Status
3) Courses: CourseCode, CourseTitle, Level, Semester, LecturerName, Venue, Schedule, Description, Status
4) Timetable: Level, CourseCode, CourseTitle, Day, Time, Venue, LecturerName, Status
5) DepartmentInfo: InfoType, Title, Details, ContactPerson, ContactPhone, LastUpdated, Status
6) AdminUsers: PhoneNumber, FullName, Role, AccessCodeHash, Status, LastVerifiedAt
7) AuditLog: Timestamp, AdminPhone, Action, SheetName, RecordID, BeforeValue, AfterValue, Result

Student answers use Active records. Announcements also require an empty ExpiryDate or a future ExpiryDate.

## Public WhatsApp capabilities

These are natural WhatsApp messages, not slash commands.

1) Latest announcement
Usage: latest announcement
Shows recent active announcements.

2) Level announcements
Usage: show me 300 level announcements
Shows active announcements for that level.

3) Course lecturer
Usage: who teaches CSC 302?
Finds the active course record and lecturer.

4) Lecturer details
Usage: show me Dr. Musa's details
Returns approved lecturer details from the Lecturers sheet.

5) Lecturer photo
Usage: send Dr. Bello's picture
Returns the approved PhotoURL. If direct media transport is later enabled by CookMyBots, this can be extended to upload the image.

6) Level timetable
Usage: show me the timetable for 200 level
Shows active timetable rows for the level.

7) Department fee
Usage: what is the department fee?
Searches active DepartmentInfo rows for fee information.

8) Department contact
Usage: who is the department contact person?
Returns approved contact details from DepartmentInfo.

## Admin WhatsApp actions

Admins are verified by approved WhatsApp phone number, admin access code, or AdminUsers sheet records.

Admin verification message:
admin code YOUR_CODE

Supported admin actions:

1) Add announcement
Starts a step-by-step flow to add an announcement.

2) Update announcement
Asks for AnnouncementID, field name, and new value.

3) Delete announcement
Archives the announcement by setting Status to Archived.

4) View active announcements
Shows active current announcements with IDs.

5) Add lecturer
Starts a step-by-step flow to add lecturer details.

6) Update lecturer
Asks for LecturerID, field name, and new value.

7) Add course
Starts a step-by-step flow to add a course.

8) Update timetable
Adds or updates a timetable row matched by Level, CourseCode, and Day.

Admins can reply cancel during a workflow.

## Environment variables

CMB_WHATSAPP_WEBHOOK_SECRET verifies CookMyBots inbound webhook calls.

COOKMYBOTS_AI_ENDPOINT is the CookMyBots AI Gateway base URL.

COOKMYBOTS_AI_KEY authenticates AI Gateway calls.

AI_TIMEOUT_MS defaults to 600000 for long AI calls.

AI_MAX_RETRIES defaults to 2.

CONCURRENCY defaults to 20, with AI work capped conservatively inside the bot.

WEB3_CHAT_MODE defaults to off.

GOOGLE_SHEETS_SPREADSHEET_ID is the department spreadsheet ID.

GOOGLE_SERVICE_ACCOUNT_EMAIL is the Google service account email.

GOOGLE_PRIVATE_KEY or GOOGLE_PRIVATE_KEY_BASE64 is the service account private key.

GOOGLE_SHEETS_CACHE_TTL_MS controls short read caching.

ADMIN_PHONE_NUMBERS is an optional comma-separated allowlist.

ADMIN_ACCESS_CODE_HASH is the preferred SHA-256 hash of the admin access code.

ADMIN_ACCESS_CODE is an optional plain setup code. Prefer the hash in production.

MONGODB_URI is optional for conversation traces and admin workflow state. Google Sheets remains the authoritative data store.

## Setup

1) Create a Google Sheet and share it with the service account email as Editor.
2) Set all required env vars in CookMyBots.
3) Connect WhatsApp Business or WhatsApp Business API inside CookMyBots.
4) Deploy this Node.js service.

Local run:

npm install
cp .env.sample .env
npm run dev

Test locally:

curl -X POST http://localhost:3000/test -H "Content-Type: application/json" -d '{"text":"latest announcement"}'

## Deployment

Use a single Node.js service.

Build command:
npm run build

Start command:
npm start

Do not deploy a Telegram bot as fallback. If WhatsApp is not connected, connect WhatsApp Business or WhatsApp Business API in CookMyBots first.

## Troubleshooting

If webhook calls return unauthorized, check CMB_WHATSAPP_WEBHOOK_SECRET.

If student questions cannot be answered, check COOKMYBOTS_AI_ENDPOINT and COOKMYBOTS_AI_KEY.

If Google Sheets answers fail, check the spreadsheet ID, service account email, private key, and sheet sharing permissions.

If admin actions are rejected, check ADMIN_PHONE_NUMBERS, ADMIN_ACCESS_CODE_HASH, ADMIN_ACCESS_CODE, or the AdminUsers sheet.

Logs are production-safe and show only booleans for secrets.
