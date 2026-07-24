const CONSULT_SHEET_NAME = "상담신청현황";
const CALENDAR_SHEET_NAME = "학사일정";
const AVAILABILITY_SHEET_NAME = "상담가능시간";
const BLOCKED_PERIOD_TITLE = "상담불가";
const SEMESTER_SLOTS = ["야자 1차시", "야자 2차시", "야자 3차시"];
const VACATION_SLOTS = ["자습 1차시", "자습 2차시", "자습 3차시", "자습 4차시"];
const CONSULT_SLOTS = SEMESTER_SLOTS.concat(VACATION_SLOTS);
const OPERATION_TYPES = ["semester", "vacation", "closed"];
const VACATION_SLOT_DEFAULTS = [
  ["08:20", "10:10"], ["10:20", "12:10"], ["13:00", "14:50"], ["15:10", "17:00"]
];
const ADMIN_PASSWORD_HASH_KEY = "ADMIN_PASSWORD_HASH";
const ADMIN_PASSWORD_SALT_KEY = "ADMIN_PASSWORD_SALT";
const ADMIN_AUTH_VERSION_KEY = "ADMIN_AUTH_VERSION";
const ADMIN_PASSWORD_SETUP_KEY = "ADMIN_PASSWORD_SETUP";
const ADMIN_SESSION_PREFIX = "ADMIN_SESSION_";
const ADMIN_SESSION_TTL_SECONDS = 30 * 60;
const DISCORD_WEBHOOK_URL_KEY = "DISCORD_WEBHOOK_URL";
const DEFAULT_ADMIN_PAGE_URL = "https://khj-hub.github.io/1-1-counseling/admin.html";
const TIME_ZONE = "Asia/Seoul";
const CALENDAR_EVENT_ID_COLUMN = 7;
const CALENDAR_EVENT_ID_HEADER = "Calendar Event ID";
const SLOT_START_STATE_KEY = "COUNSELING_SLOT_START_STATE";
const SUMMARY_STATE_KEY = "COUNSELING_SUMMARY_STATE";
const COUNSELING_TRIGGER_HANDLERS = [
  "checkCounselingSlotStartNotifications",
  "runTodayCounselingSummary",
  "runTomorrowCounselingSummary"
];
const SLOT_PROPERTY_MAP = {
  "야자 1차시": { start: "SLOT_1_START", end: "SLOT_1_END" },
  "야자 2차시": { start: "SLOT_2_START", end: "SLOT_2_END" },
  "야자 3차시": { start: "SLOT_3_START", end: "SLOT_3_END" },
  "자습 1차시": { start: "VACATION_SLOT_1_START", end: "VACATION_SLOT_1_END", defaults: VACATION_SLOT_DEFAULTS[0] },
  "자습 2차시": { start: "VACATION_SLOT_2_START", end: "VACATION_SLOT_2_END", defaults: VACATION_SLOT_DEFAULTS[1] },
  "자습 3차시": { start: "VACATION_SLOT_3_START", end: "VACATION_SLOT_3_END", defaults: VACATION_SLOT_DEFAULTS[2] },
  "자습 4차시": { start: "VACATION_SLOT_4_START", end: "VACATION_SLOT_4_END", defaults: VACATION_SLOT_DEFAULTS[3] }
};

function getKoreanHolidays(year) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "HOLIDAYS_" + year;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    try {
      return JSON.parse(cachedData);
    } catch(e) {}
  }
  
  const properties = getScriptProperties();
  const calendarId = properties.getProperty("KOREAN_HOLIDAY_CALENDAR_ID") || "ko.south_korea#holiday@group.v.calendar.google.com";
  const holidays = {};
  
  try {
    const calendar = CalendarApp.getCalendarById(calendarId);
    if (calendar) {
      const startDate = new Date(year + "-01-01T00:00:00+09:00");
      const endDate = new Date(year + "-12-31T23:59:59+09:00");
      const events = calendar.getEvents(startDate, endDate);
      events.forEach(event => {
        const dateStr = Utilities.formatDate(event.getStartTime(), TIME_ZONE, "yyyy-MM-dd");
        holidays[dateStr] = event.getTitle();
      });
      cache.put(cacheKey, JSON.stringify(holidays), 21600);
    }
  } catch(error) {
    console.error("Failed to fetch holidays for year " + year + ": " + error);
  }
  
  return holidays;
}

function textOutput(value) {
  return ContentService.createTextOutput(value).setMimeType(ContentService.MimeType.TEXT);
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function getScriptProperties() {
  return PropertiesService.getScriptProperties();
}

function logServerError(context, error) {
  const detail = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
  console.error(context + ": " + detail);
}

function getAdminPageUrl() {
  return getScriptProperties().getProperty("ADMIN_PAGE_URL") || DEFAULT_ADMIN_PAGE_URL;
}

function isPropertyEnabled(key) {
  return (getScriptProperties().getProperty(key) || "").toLowerCase() === "true";
}

function sendDiscordPayload(payload) {
  const webhookUrl = getScriptProperties().getProperty(DISCORD_WEBHOOK_URL_KEY);
  if (!webhookUrl) {
    console.error("Discord notification skipped: DISCORD_WEBHOOK_URL is not configured.");
    return false;
  }

  try {
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(Object.assign({}, payload, { allowed_mentions: { parse: [] } })),
      muteHttpExceptions: true
    });
    const statusCode = response.getResponseCode();
    if (statusCode < 200 || statusCode >= 300) {
      console.error("Discord notification failed with HTTP status " + statusCode + ".");
      return false;
    }
    return true;
  } catch (error) {
    console.error("Discord notification failed because the request could not be completed.");
    return false;
  }
}

function sendDiscordMessage(message) {
  return sendDiscordPayload({ content: message });
}

function sendDiscordEmbed(embed) {
  return sendDiscordPayload({ embeds: [embed] });
}

function discordTimestampLabel() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd HH:mm:ss");
}

function notifyDiscordReservation(name, date, slot) {
  return sendDiscordEmbed({
    title: "🌿 새로운 상담 예약",
    url: getAdminPageUrl(),
    color: 5763719,
    fields: [
      { name: "학생 이름", value: name, inline: true },
      { name: "상담 날짜", value: date, inline: true },
      { name: "상담 시간대", value: formatSlotWithTime(slot), inline: true },
      { name: "신청 시각", value: discordTimestampLabel(), inline: false },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function notifyDiscordCancellation(name, date, slot) {
  return sendDiscordEmbed({
    title: "❌ 상담 예약 취소",
    url: getAdminPageUrl(),
    color: 14495300,
    fields: [
      { name: "학생 이름", value: name, inline: true },
      { name: "상담 날짜", value: date, inline: true },
      { name: "상담 시간대", value: formatSlotWithTime(slot), inline: true },
      { name: "취소 시각", value: discordTimestampLabel(), inline: false },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function testDiscordNotification() {
  return sendDiscordMessage("🔔 상담 예약 시스템 Discord Webhook 테스트 알림입니다.");
}

function notifyDiscordReservationSafely(name, date, slot) {
  try {
    notifyDiscordReservation(name, date, slot);
  } catch (error) {
    console.error("Discord reservation notification failed.");
  }
}

function notifyDiscordCancellationSafely(name, date, slot) {
  try {
    notifyDiscordCancellation(name, date, slot);
  } catch (error) {
    console.error("Discord cancellation notification failed.");
  }
}

function createPasswordSalt() {
  return Utilities.getUuid() + Utilities.getUuid();
}

function hashAdminPassword(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + password,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest);
}

function constantTimeEquals(left, right) {
  const a = (left || "").toString();
  const b = (right || "").toString();
  let difference = a.length ^ b.length;
  const maxLength = Math.max(a.length, b.length);
  for (let i = 0; i < maxLength; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function verifyAdminPassword(password) {
  const properties = getScriptProperties();
  const salt = properties.getProperty(ADMIN_PASSWORD_SALT_KEY);
  const savedHash = properties.getProperty(ADMIN_PASSWORD_HASH_KEY);
  if (!salt || !savedHash || !password) return false;
  return constantTimeEquals(hashAdminPassword(password.toString(), salt), savedHash);
}

function saveAdminPassword(password) {
  const normalizedPassword = password ? password.toString() : "";
  if (normalizedPassword.length < 4 || normalizedPassword.length > 64) {
    throw new Error("ADMIN_PASSWORD_POLICY");
  }

  const properties = getScriptProperties();
  const salt = createPasswordSalt();
  const currentVersion = Number(properties.getProperty(ADMIN_AUTH_VERSION_KEY) || "0");
  properties.setProperties({
    [ADMIN_PASSWORD_SALT_KEY]: salt,
    [ADMIN_PASSWORD_HASH_KEY]: hashAdminPassword(normalizedPassword, salt),
    [ADMIN_AUTH_VERSION_KEY]: String(currentVersion + 1)
  });
}

function initializeAdminPassword() {
  const properties = getScriptProperties();
  const setupPassword = properties.getProperty(ADMIN_PASSWORD_SETUP_KEY);
  if (!setupPassword) {
    throw new Error("프로젝트 설정의 Script Properties에 ADMIN_PASSWORD_SETUP을 먼저 입력하세요.");
  }
  saveAdminPassword(setupPassword);
  properties.deleteProperty(ADMIN_PASSWORD_SETUP_KEY);
}

function getAdminAuthVersion() {
  return getScriptProperties().getProperty(ADMIN_AUTH_VERSION_KEY) || "0";
}

function createAdminSession() {
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  CacheService.getScriptCache().put(
    ADMIN_SESSION_PREFIX + token,
    getAdminAuthVersion(),
    ADMIN_SESSION_TTL_SECONDS
  );
  return token;
}

function isValidAdminSession(token) {
  if (!token) return false;
  const cachedVersion = CacheService.getScriptCache().get(ADMIN_SESSION_PREFIX + token);
  return cachedVersion !== null && constantTimeEquals(cachedVersion, getAdminAuthVersion());
}

function removeAdminSession(token) {
  if (token) CacheService.getScriptCache().remove(ADMIN_SESSION_PREFIX + token);
}

function requireAdminSession(data) {
  if (!isValidAdminSession(data.token)) {
    return jsonOutput({ ok: false, error: "AUTH_REQUIRED" });
  }
  return null;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(value + "T00:00:00+09:00");
  return !isNaN(parsed.getTime()) && Utilities.formatDate(parsed, "GMT+9", "yyyy-MM-dd") === value;
}

function validateCalendarInput(data) {
  const startDate = data.startDate ? data.startDate.toString().trim() : "";
  const endDate = data.endDate ? data.endDate.toString().trim() : startDate;
  const kind = data.kind === "blocked" ? "blocked" : "academic";
  const title = data.title ? data.title.toString().trim() : "";

  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return { ok: false, error: "INVALID_DATE" };
  }
  if (new Date(startDate + "T00:00:00+09:00") > new Date(endDate + "T00:00:00+09:00")) {
    return { ok: false, error: "INVALID_DATE_RANGE" };
  }
  if (kind === "academic" && !title) {
    return { ok: false, error: "TITLE_REQUIRED" };
  }
  if (title.length > 100) return { ok: false, error: "TITLE_TOO_LONG" };

  return {
    ok: true,
    startDate: startDate,
    endDate: endDate,
    title: kind === "blocked" ? BLOCKED_PERIOD_TITLE : title,
    kind: kind
  };
}

function parseKoreanDate(dateVal) {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return Utilities.formatDate(dateVal, "GMT+9", "yyyy-MM-dd");
  let str = dateVal.toString().trim().replace(/[^0-9가-힣./\-\s]/g, ''); 
  const currentYear = new Date().getFullYear(); 
  if (/^\d+$/.test(str)) {
    if (str.length === 3) str = "0" + str; 
    if (str.length === 8) return str.substring(0, 4) + "-" + str.substring(4, 6) + "-" + str.substring(6, 8);
    else if (str.length === 4) return currentYear + "-" + str.substring(0, 2) + "-" + str.substring(2, 4);
  }
  if (str.includes('.')) {
    let parts = str.split('.').map(p => p.trim()).filter(p => p !== '');
    if (parts.length === 2) return currentYear + "-" + padZero(parts[0]) + "-" + padZero(parts[1]);
    else if (parts.length === 3) { let year = parts[0]; if (year.length === 2) year = "20" + year; return year + "-" + padZero(parts[1]) + "-" + padZero(parts[2]); }
  }
  const krDateMatch = str.match(/(\d+)월\s*(\d+)일/);
  if (krDateMatch) return currentYear + "-" + padZero(krDateMatch[1]) + "-" + padZero(krDateMatch[2]);
  if (str.includes('/')) {
    let parts = str.split('/').map(p => p.trim());
    if (parts.length === 2) return currentYear + "-" + padZero(parts[0]) + "-" + padZero(parts[1]);
    else if (parts.length === 3) { let year = parts[0]; if (year.length === 2) year = "20" + year; return year + "-" + padZero(parts[1]) + "-" + padZero(parts[2]); }
  }
  try { const d = new Date(str); if (!isNaN(d.getTime())) return Utilities.formatDate(d, "GMT+9", "yyyy-MM-dd"); } catch(e) {}
  return null; 
}
function padZero(num) { return num.toString().padStart(2, '0'); }

function getDatesStartToIn(startDateStr, endDateStr) {
  let dates = []; let start = new Date(startDateStr); let end = new Date(endDateStr);
  while (start <= end) { dates.push(Utilities.formatDate(start, "GMT+9", "yyyy-MM-dd")); start.setDate(start.getDate() + 1); }
  return dates;
}

function sheetBoolean(value) {
  if (value === true || value === false) return value;
  return Boolean(value) && value.toString().trim().toUpperCase() === "TRUE";
}

function normalizeOperationType(value) {
  const normalized = (value || "").toString().trim().toLowerCase();
  if (normalized === "vacation" || normalized === "방학") return "vacation";
  if (normalized === "closed" || normalized === "상담 불가" || normalized === "상담불가") return "closed";
  return "semester";
}

function hasExtendedAvailabilityHeaders(sheet) {
  if (!sheet) return false;
  const headers = sheet.getRange(1, 5, 1, 3).getValues()[0].map(value => (value || "").toString().trim());
  return headers[0] === "운영유형" && headers[1] === "4차시" && headers[2] === "비고";
}

function getAvailabilitySettings(ss) {
  const sheet = ss.getSheetByName(AVAILABILITY_SHEET_NAME);
  const settings = {};
  if (!sheet) return settings;

  const rows = sheet.getDataRange().getValues();
  const extended = hasExtendedAvailabilityHeaders(sheet);
  for (let i = 1; i < rows.length; i++) {
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    const operationType = extended ? normalizeOperationType(rows[i][4]) : "semester";
    const slotNames = operationType === "vacation" ? VACATION_SLOTS : SEMESTER_SLOTS;
    const flags = [sheetBoolean(rows[i][1]), sheetBoolean(rows[i][2]), sheetBoolean(rows[i][3]), extended && sheetBoolean(rows[i][5])];
    const slots = {};
    slotNames.forEach((slot, index) => { slots[slot] = operationType !== "closed" && flags[index] === true; });
    settings[date] = { operationType: operationType, slots: slots, note: extended && rows[i][6] ? rows[i][6].toString() : "", row: i + 1 };
  }
  return settings;
}

function getAvailabilityMap(ss) {
  const settings = getAvailabilitySettings(ss);
  const availability = {};
  Object.keys(settings).forEach(date => { availability[date] = settings[date].slots; });
  return availability;
}

function isVacationTitle(title) {
  return (title || "").toString().indexOf("방학") !== -1;
}

function getAcademicDateState(ss, date) {
  const sheet = ss.getSheetByName(CALENDAR_SHEET_NAME);
  const state = { vacation: false, blocked: false };
  if (!sheet) return state;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const startDate = parseKoreanDate(rows[i][0]);
    const endDate = rows[i][1] ? parseKoreanDate(rows[i][1]) : startDate;
    if (!startDate || !endDate || date < startDate || date > endDate) continue;
    if (isVacationTitle(rows[i][2])) state.vacation = true;
    else state.blocked = true;
  }
  return state;
}

function getDateOperation(ss, date) {
  const setting = getAvailabilitySettings(ss)[date];
  if (setting) return setting;
  const academic = getAcademicDateState(ss, date);
  if (academic.vacation) return { operationType: "vacation", slots: {}, note: "" };
  const slots = {}; SEMESTER_SLOTS.forEach(slot => { slots[slot] = true; });
  return { operationType: "semester", slots: slots, note: "" };
}

function getAllowedSlotsForDate(ss, date) {
  const operation = getDateOperation(ss, date);
  if (operation.operationType === "closed") return [];
  return Object.keys(operation.slots).filter(slot => operation.slots[slot] === true);
}

function isDateBlocked(ss, date) {
  return getAcademicDateState(ss, date).blocked;
}

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];
  
  const sheet1 = ss.getSheetByName("상담신청현황"); 
  const data1 = sheet1 ? sheet1.getDataRange().getValues() : [];
  
  const slotColors = { 
    "야자 1차시": "#d0c3fa",
    "야자 2차시": "#b5ead7",
    "야자 3차시": "#ffeaa7"
  };
  const defaultColor = "#caffbf"; 

  for (let i = 1; i < data1.length; i++) {
    if(data1[i][0]) {
      const fmtDate = parseKoreanDate(data1[i][0]); 
      if (!fmtDate) continue; 
      const slot = data1[i][1] ? data1[i][1].toString().trim() : "";
      const completed = sheetBoolean(data1[i][4]);
      const color = completed ? "#d8d3e6" : (slotColors[slot] || defaultColor);
      const extendedProps = completed
        ? { slot: slot, type: "consult", completed: true }
        : { slot: slot, name: data1[i][2], type: "consult", completed: false };
      
      results.push({ 
        title: completed ? "상담완료" : data1[i][2],
        start: fmtDate, 
        allDay: true, 
        backgroundColor: color, 
        borderColor: color, 
        textColor: "#495057", 
        extendedProps: extendedProps
      });
    }
  }

  const sheet2 = ss.getSheetByName("학사일정");
  const holidays = [];
  const vacationDates = [];

  // ─── 1단계: 학사일정 시트 → 기간 바(bar) 형태로 달력에 표시 ───
  // blockedDates는 예약 차단 판단용 날짜 Set (script.js의 sheetHolidays 배열로 전달됨)
  const blockedDates = new Set();

  if (sheet2) {
    const holidayData = sheet2.getDataRange().getValues();
    for (var j = 1; j < holidayData.length; j++) {
      const startDateVal = holidayData[j][0];
      const endDateVal   = holidayData[j][1];
      const hTitle       = holidayData[j][2] || "상담불가";
      const vacation = isVacationTitle(hTitle);

      if (!startDateVal) continue;
      const startFmt = parseKoreanDate(startDateVal);
      const endFmt   = endDateVal ? parseKoreanDate(endDateVal) : startFmt;
      if (!startFmt || !endFmt) continue;

      // 기간 내 날짜를 holidays 배열(클릭 차단용)에 등록
      getDatesStartToIn(startFmt, endFmt).forEach(d => {
        if (vacation) vacationDates.push(d);
        else { blockedDates.add(d); holidays.push(d); }
      });

      // FullCalendar에는 기간 전체를 하나의 이벤트(bar)로 추가
      // FullCalendar의 exclusive end date 규칙에 따라 endFmt + 1일
      let calendarEnd = new Date(endFmt + "T00:00:00+09:00");
      calendarEnd.setDate(calendarEnd.getDate() + 1);
      const calendarEndStr = Utilities.formatDate(calendarEnd, "GMT+9", "yyyy-MM-dd");

      results.push({
        title: vacation ? hTitle : "🚫 " + hTitle + " 🚫",
        start: startFmt, end: calendarEndStr, allDay: true,
        backgroundColor: vacation ? "#dbeafe" : "#e8e6f2", borderColor: vacation ? "#93c5fd" : "#e8e6f2", textColor: "#5a5570",
        extendedProps: { type: vacation ? "vacation" : "holiday", reason: hTitle }
      });
    }
  }

  // ─── 2단계: 구글 캘린더 공휴일 → 학사일정과 겹치지 않는 날만 하루씩 표시 ───
  const currentYear = new Date().getFullYear();
  const krHolidays = Object.assign({}, getKoreanHolidays(currentYear), getKoreanHolidays(currentYear + 1));
  const publicHolidays = Object.keys(krHolidays);
  for (const date in krHolidays) {
    if (blockedDates.has(date)) continue; // 이미 학사일정에 포함된 날 중복 방지

    holidays.push(date);
    let calendarEnd = new Date(date + "T00:00:00+09:00");
    calendarEnd.setDate(calendarEnd.getDate() + 1);
    const calendarEndStr = Utilities.formatDate(calendarEnd, "GMT+9", "yyyy-MM-dd");

    results.push({
      title: "🚫 " + krHolidays[date] + " 🚫",
      start: date, end: calendarEndStr, allDay: true,
      backgroundColor: "#e8e6f2", borderColor: "#e8e6f2", textColor: "#5a5570",
      extendedProps: { type: "holiday", reason: krHolidays[date] }
    });
  }

  const availabilitySettings = getAvailabilitySettings(ss);
  const operationTypes = {};
  const availabilityNotes = {};
  Object.keys(availabilitySettings).forEach(date => {
    operationTypes[date] = availabilitySettings[date].operationType;
    availabilityNotes[date] = availabilitySettings[date].note;
  });
  const slotTimes = {};
  CONSULT_SLOTS.forEach(slot => { const config = getSlotTimeConfig(slot); if (config) slotTimes[slot] = { start: config.start, end: config.end }; });
  return jsonOutput({
    events: results,
    holidays: [...new Set(holidays)],
    publicHolidays: publicHolidays,
    vacationDates: [...new Set(vacationDates)],
    availability: getAvailabilityMap(ss),
    operationTypes: operationTypes,
    availabilityNotes: availabilityNotes,
    slotTimes: slotTimes
  });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (error) {
    return textOutput("INVALID_REQUEST");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return textOutput("INVALID_REQUEST");
  }

  if (data.action && data.action.indexOf("admin") === 0) {
    try {
      return handleAdminAction(data);
    } catch (error) {
      logServerError("Admin action failed [" + data.action + "]", error);
      return jsonOutput({ ok: false, error: "SERVER_ERROR" });
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return textOutput("Sheet Not Found");

  const { action, date, slot, name, password } = data;
  const trimmedName = name ? name.trim() : "";
  const trimmedPwd = password ? password.toString().trim() : "";

  if (action === "save") {
    if (!trimmedName) return textOutput("NAME_REQUIRED");
    if (trimmedName.length > 100) return textOutput("INVALID_NAME");
    if (!isIsoDate(date)) return textOutput("INVALID_DATE");
    if (CONSULT_SLOTS.indexOf(slot) === -1) return textOutput("INVALID_SLOT");
    if (!/^\d{4}$/.test(trimmedPwd)) return textOutput("INVALID_PASSWORD");

    const lock = LockService.getScriptLock();
    let savedRowNumber = null;
    let earlyResult = null; // lock 안에서 조기 반환이 필요한 경우 여기에 저장
    lock.waitLock(10000);
    try {
      const reqDate = new Date(date + "T00:00:00+09:00");
      const day = reqDate.getDay();
      if (date < localIsoDate(new Date())) earlyResult = "PAST_DATE_NOT_ALLOWED";
      if (!earlyResult && (day === 0 || day === 6)) earlyResult = "WEEKEND_NOT_ALLOWED";

      if (!earlyResult) {
        const krHolidays = getKoreanHolidays(reqDate.getFullYear());
        if (krHolidays[date]) earlyResult = "HOLIDAY_NOT_ALLOWED:" + krHolidays[date];
      }

      if (!earlyResult && isDateBlocked(ss, date)) earlyResult = "DATE_BLOCKED";

      if (!earlyResult) {
        const allowedSlots = getAllowedSlotsForDate(ss, date);
        if (allowedSlots.indexOf(slot) === -1) earlyResult = "SLOT_UNAVAILABLE";
      }

      if (!earlyResult) {
        const rows = sheet.getDataRange().getValues();
        const slotTaken = rows.slice(1).some(row => {
          return parseKoreanDate(row[0]) === date &&
            (row[1] ? row[1].toString().trim() : "") === slot;
        });
        if (slotTaken) {
          earlyResult = "SLOT_TAKEN";
        } else {
          const mondayDiff = day === 0 ? -6 : 1 - day;
          const mon = new Date(reqDate); mon.setDate(reqDate.getDate() + mondayDiff); mon.setHours(0,0,0,0);
          const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);

          const isDuplicate = rows.slice(1).some(row => {
            const rowDate = parseKoreanDate(row[0]);
            const sDate = rowDate ? new Date(rowDate + "T00:00:00+09:00").getTime() : NaN;
            const rowName = row[2] ? row[2].toString().trim() : "";
            return rowName === trimmedName && sDate >= mon.getTime() && sDate <= sun.getTime();
          });
          if (isDuplicate) {
            earlyResult = "DUPLICATE_WEEKLY";
          } else {
            sheet.appendRow([date, slot, trimmedName, trimmedPwd]);
            savedRowNumber = sheet.getLastRow();
          }
        }
      }
    } finally {
      lock.releaseLock();
    }
    // lock 블록 안에서 조기 반환된 경우 여기서 처리 (알림 없이 종료)
    if (earlyResult) return textOutput(earlyResult);
    // 정상 저장 완료 시에만 디스코드 알림 및 캘린더 이벤트 생성
    notifyDiscordReservationSafely(trimmedName, date, slot);
    createCalendarEventForReservationSafely(savedRowNumber, date, slot, trimmedName);
    return textOutput("Success");
  } else if (action === "delete") {
    const lock = LockService.getScriptLock();
    let deleteResult = "NOT_FOUND";
    let calendarEventId = "";
    lock.waitLock(10000);
    try {
      const rows = sheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        // parseKoreanDate로 날짜 형식을 통일하여 비교 (Date 객체/문자열 혼용 방지)
        const rDate = parseKoreanDate(rows[i][0]);
        if (rDate === date && rows[i][1] === slot && rows[i][2] === trimmedName) {
          if (sheetBoolean(rows[i][4])) {
            deleteResult = "COMPLETED_RESERVATION";
            break;
          }
          const savedPwd = rows[i][3] ? rows[i][3].toString().trim() : "";
          if (verifyAdminPassword(trimmedPwd) || trimmedPwd === savedPwd) {
            calendarEventId = rows[i][CALENDAR_EVENT_ID_COLUMN - 1] ? rows[i][CALENDAR_EVENT_ID_COLUMN - 1].toString().trim() : "";
            sheet.deleteRow(i + 1);
            deleteResult = "Success";
          } else {
            deleteResult = "WRONG_PASSWORD";
          }
          break;
        }
      }
    } finally {
      lock.releaseLock();
    }
    if (deleteResult === "Success") {
      notifyDiscordCancellationSafely(trimmedName, date, slot);
      deleteCalendarEventSafely(calendarEventId);
    }
    return textOutput(deleteResult);
  }

  return textOutput("INVALID_ACTION");
}

function handleAdminAction(data) {
  if (data.action === "adminLogin") {
    if (!verifyAdminPassword(data.password)) {
      Utilities.sleep(250);
      return jsonOutput({ ok: false, error: "INVALID_CREDENTIALS" });
    }
    return jsonOutput({
      ok: true,
      token: createAdminSession(),
      expiresIn: ADMIN_SESSION_TTL_SECONDS
    });
  }

  const authError = requireAdminSession(data);
  if (authError) return authError;

  if (data.action === "adminLogout") {
    removeAdminSession(data.token);
    return jsonOutput({ ok: true });
  }
  if (data.action === "adminListReservations") return adminListReservations(data);
  if (data.action === "adminDeleteReservation") return adminDeleteReservation(data);
  if (data.action === "adminUpdateConsultation") return adminUpdateConsultation(data);
  if (data.action === "adminListStudentHistory") return adminListStudentHistory(data);
  if (data.action === "adminListCalendarItems") return adminListCalendarItems();
  if (data.action === "adminCreateCalendarItem") return adminCreateCalendarItem(data);
  if (data.action === "adminUpdateCalendarItem") return adminUpdateCalendarItem(data);
  if (data.action === "adminDeleteCalendarItem") return adminDeleteCalendarItem(data);
  if (data.action === "adminListAvailability") return adminListAvailability();
  if (data.action === "adminSetAvailability") return adminSetAvailability(data);
  if (data.action === "adminDeleteAvailability") return adminDeleteAvailability(data);
  if (data.action === "adminChangePassword") return adminChangePassword(data);
  if (data.action === "adminGetCounselingStats") return adminGetCounselingStats(data);
  if (data.action === "adminGetIntegrationStatus") return adminGetIntegrationStatus();
  if (data.action === "adminTestDiscord") return adminRunIntegrationTest(testDiscordNotification);
  if (data.action === "adminTestTodaySummary") return adminRunIntegrationTest(testTodayCounselingSummary);
  if (data.action === "adminTestTomorrowSummary") return adminRunIntegrationTest(testTomorrowCounselingSummary);
  if (data.action === "adminTestSlotStart") return adminRunIntegrationTest(testSlotStartNotification);

  return jsonOutput({ ok: false, error: "INVALID_ACTION" });
}

function adminListReservations(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const includeCompleted = Boolean(data && data.includeCompleted === true);
  const rows = sheet.getDataRange().getValues();
  const reservations = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    const completed = sheetBoolean(rows[i][4]);
    if (completed && !includeCompleted) continue;
    reservations.push({
      row: i + 1,
      date: date,
      slot: rows[i][1] ? rows[i][1].toString().trim() : "",
      name: rows[i][2] ? rows[i][2].toString() : "",
      completed: completed,
      memo: rows[i][5] ? rows[i][5].toString() : ""
    });
  }

  reservations.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.slot.localeCompare(b.slot);
  });
  return jsonOutput({ ok: true, reservations: reservations });
}

function adminDeleteReservation(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const rowNumber = Number(data.row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }

  const lock = LockService.getScriptLock();
  let calendarEventId = "";
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const row = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
    const currentDate = parseKoreanDate(row[0]);
    const currentSlot = row[1] ? row[1].toString().trim() : "";
    const currentName = row[2] ? row[2].toString() : "";

    if (currentDate !== data.date || currentSlot !== data.slot || currentName !== data.name) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    calendarEventId = row[CALENDAR_EVENT_ID_COLUMN - 1] ? row[CALENDAR_EVENT_ID_COLUMN - 1].toString().trim() : "";
    sheet.deleteRow(rowNumber);
  } finally {
    lock.releaseLock();
  }
  deleteCalendarEventSafely(calendarEventId);
  return jsonOutput({ ok: true });
}

function adminUpdateConsultation(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const rowNumber = Number(data.row);
  const memo = data.memo === undefined || data.memo === null ? "" : data.memo.toString().trim();
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }
  if (typeof data.completed !== "boolean") {
    return jsonOutput({ ok: false, error: "INVALID_COMPLETED" });
  }
  if (memo.length > 2000) return jsonOutput({ ok: false, error: "MEMO_TOO_LONG" });

  const lock = LockService.getScriptLock();
  let calendarEventId = "";
  let reservationName = "";
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const row = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
    const currentDate = parseKoreanDate(row[0]);
    const currentSlot = row[1] ? row[1].toString().trim() : "";
    const currentName = row[2] ? row[2].toString() : "";
    if (currentDate !== data.date || currentSlot !== data.slot || currentName !== data.name) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    sheet.getRange(rowNumber, 5, 1, 2).setValues([[data.completed, memo]]);
    calendarEventId = row[CALENDAR_EVENT_ID_COLUMN - 1] ? row[CALENDAR_EVENT_ID_COLUMN - 1].toString().trim() : "";
    reservationName = currentName;
  } finally {
    lock.releaseLock();
  }
  updateCalendarCompletionSafely(calendarEventId, reservationName, data.completed);
  return jsonOutput({ ok: true });
}

function adminListStudentHistory(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const name = data.name ? data.name.toString().trim() : "";
  if (!name) return jsonOutput({ ok: false, error: "NAME_REQUIRED" });

  const rows = sheet.getDataRange().getValues();
  const history = [];
  for (let i = 1; i < rows.length; i++) {
    const rowName = rows[i][2] ? rows[i][2].toString().trim() : "";
    if (rowName !== name) continue;
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    history.push({
      row: i + 1,
      date: date,
      slot: rows[i][1] ? rows[i][1].toString().trim() : "",
      name: rowName,
      completed: sheetBoolean(rows[i][4]),
      memo: rows[i][5] ? rows[i][5].toString() : ""
    });
  }
  history.sort((a, b) => a.date === b.date ? a.slot.localeCompare(b.slot) : (a.date < b.date ? 1 : -1));
  return jsonOutput({ ok: true, name: name, history: history });
}

function adminListAvailability() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "AVAILABILITY_SHEET_NOT_FOUND" });

  const settings = getAvailabilitySettings(SpreadsheetApp.getActiveSpreadsheet());
  const items = Object.keys(settings).map(date => ({ row: settings[date].row, date: date, operationType: settings[date].operationType,
    slots: (settings[date].operationType === "vacation" ? VACATION_SLOTS : SEMESTER_SLOTS).map(slot => settings[date].slots[slot] === true),
    note: settings[date].note }));
  const slotTimes = {};
  CONSULT_SLOTS.forEach(slot => {
    const config = getSlotTimeConfig(slot);
    if (config) slotTimes[slot] = config.start + "~" + config.end;
  });
  items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return jsonOutput({ ok: true, items: items, slotTimes: slotTimes, extendedColumnsReady: hasExtendedAvailabilityHeaders(sheet) });
}

function validateAvailabilityInput(data) {
  const date = data.date ? data.date.toString().trim() : "";
  const rawOperationType = data.operationType === undefined || data.operationType === null ? "" : data.operationType.toString().trim();
  if (rawOperationType && OPERATION_TYPES.indexOf(rawOperationType) === -1) return { ok: false, error: "INVALID_AVAILABILITY" };
  const operationType = normalizeOperationType(data.operationType);
  const expectedLength = operationType === "vacation" ? 4 : operationType === "closed" ? 0 : 3;
  const note = data.note === undefined || data.note === null ? "" : data.note.toString().trim();
  if (!isIsoDate(date)) return { ok: false, error: "INVALID_DATE" };
  if (OPERATION_TYPES.indexOf(operationType) === -1 || !Array.isArray(data.slots) || data.slots.length !== expectedLength ||
      data.slots.some(value => typeof value !== "boolean")) {
    return { ok: false, error: "INVALID_AVAILABILITY" };
  }
  if (note.length > 200) return { ok: false, error: "NOTE_TOO_LONG" };
  return { ok: true, date: date, operationType: operationType, slots: operationType === "closed" ? [false, false, false] : data.slots, note: note };
}

function adminSetAvailability(data) {
  const input = validateAvailabilityInput(data);
  if (!input.ok) return jsonOutput(input);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "AVAILABILITY_SHEET_NOT_FOUND" });
  if (!hasExtendedAvailabilityHeaders(sheet)) return jsonOutput({ ok: false, error: "AVAILABILITY_COLUMNS_REQUIRED" });
  const rowNumber = data.row === undefined || data.row === null || data.row === "" ? null : Number(data.row);
  if (rowNumber !== null && (!Number.isInteger(rowNumber) || rowNumber < 2)) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = sheet.getDataRange().getValues();
    if (rowNumber === null) {
      const duplicate = rows.slice(1).some(row => parseKoreanDate(row[0]) === input.date);
      if (duplicate) return jsonOutput({ ok: false, error: "AVAILABILITY_EXISTS" });
      const flags = input.slots.concat([false, false, false, false]).slice(0, 4);
      sheet.appendRow([input.date, flags[0], flags[1], flags[2], input.operationType, flags[3], input.note]);
    } else {
      if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
      const currentDate = parseKoreanDate(sheet.getRange(rowNumber, 1).getValue());
      if (currentDate !== data.expectedDate) return jsonOutput({ ok: false, error: "STALE_DATA" });
      const duplicate = rows.slice(1).some((row, index) => index + 2 !== rowNumber && parseKoreanDate(row[0]) === input.date);
      if (duplicate) return jsonOutput({ ok: false, error: "AVAILABILITY_EXISTS" });
      const flags = input.slots.concat([false, false, false, false]).slice(0, 4);
      sheet.getRange(rowNumber, 1, 1, 7).setValues([[input.date, flags[0], flags[1], flags[2], input.operationType, flags[3], input.note]]);
    }
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminDeleteAvailability(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "AVAILABILITY_SHEET_NOT_FOUND" });
  const rowNumber = Number(data.row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const currentDate = parseKoreanDate(sheet.getRange(rowNumber, 1).getValue());
    if (currentDate !== data.date) return jsonOutput({ ok: false, error: "STALE_DATA" });
    sheet.deleteRow(rowNumber);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminListCalendarItems() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALENDAR_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const rows = sheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const startDate = parseKoreanDate(rows[i][0]);
    const endDate = rows[i][1] ? parseKoreanDate(rows[i][1]) : startDate;
    if (!startDate || !endDate) continue;
    const rawTitle = rows[i][2] ? rows[i][2].toString().trim() : "";
    items.push({
      row: i + 1,
      startDate: startDate,
      endDate: endDate,
      title: rawTitle || BLOCKED_PERIOD_TITLE,
      kind: !rawTitle || rawTitle === BLOCKED_PERIOD_TITLE ? "blocked" : "academic",
      readonly: false
    });
  }

  const currentYear = new Date().getFullYear();
  const krHolidays = Object.assign({}, getKoreanHolidays(currentYear), getKoreanHolidays(currentYear + 1));
  let rowId = -1000;
  for (const date in krHolidays) {
    items.push({
      row: rowId--,
      startDate: date,
      endDate: date,
      title: krHolidays[date],
      kind: "academic",
      readonly: true
    });
  }

  items.sort((a, b) => a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);
  return jsonOutput({ ok: true, items: items });
}

function adminCreateCalendarItem(data) {
  const input = validateCalendarInput(data);
  if (!input.ok) return jsonOutput(input);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALENDAR_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow([input.startDate, input.endDate, input.title]);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminUpdateCalendarItem(data) {
  const input = validateCalendarInput(data);
  if (!input.ok) return jsonOutput(input);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALENDAR_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const rowNumber = Number(data.row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const current = sheet.getRange(rowNumber, 1, 1, 3).getValues()[0];
    const currentStart = parseKoreanDate(current[0]);
    const currentEnd = current[1] ? parseKoreanDate(current[1]) : currentStart;
    const currentTitle = current[2] ? current[2].toString().trim() : BLOCKED_PERIOD_TITLE;
    if (currentStart !== data.expectedStartDate || currentEnd !== data.expectedEndDate || currentTitle !== data.expectedTitle) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    sheet.getRange(rowNumber, 1, 1, 3).setValues([[input.startDate, input.endDate, input.title]]);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminDeleteCalendarItem(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CALENDAR_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const rowNumber = Number(data.row);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return jsonOutput({ ok: false, error: "INVALID_ROW" });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const current = sheet.getRange(rowNumber, 1, 1, 3).getValues()[0];
    const currentStart = parseKoreanDate(current[0]);
    const currentEnd = current[1] ? parseKoreanDate(current[1]) : currentStart;
    const currentTitle = current[2] ? current[2].toString().trim() : BLOCKED_PERIOD_TITLE;
    if (currentStart !== data.startDate || currentEnd !== data.endDate || currentTitle !== data.title) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    sheet.deleteRow(rowNumber);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function adminChangePassword(data) {
  if (!verifyAdminPassword(data.currentPassword)) {
    return jsonOutput({ ok: false, error: "WRONG_CURRENT_PASSWORD" });
  }

  const newPassword = data.newPassword ? data.newPassword.toString() : "";
  if (newPassword.length < 4 || newPassword.length > 64) {
    return jsonOutput({ ok: false, error: "ADMIN_PASSWORD_POLICY" });
  }

  saveAdminPassword(newPassword);
  return jsonOutput({ ok: true, reloginRequired: true });
}

function getSlotTimeConfig(slot) {
  const propertyKeys = SLOT_PROPERTY_MAP[slot];
  if (!propertyKeys) return null;
  const properties = getScriptProperties();
  const start = properties.getProperty(propertyKeys.start) || (propertyKeys.defaults ? propertyKeys.defaults[0] : "");
  const end = properties.getProperty(propertyKeys.end) || (propertyKeys.defaults ? propertyKeys.defaults[1] : "");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    console.error("Counseling slot time skipped: invalid or missing properties for " + slot + ".");
    return null;
  }
  if (timeToMinutes(end) <= timeToMinutes(start)) {
    console.error("Counseling slot time skipped: end time must be later than start time for " + slot + ".");
    return null;
  }
  return { slot: slot, start: start, end: end };
}

function formatSlotWithTime(slot) {
  const config = getSlotTimeConfig(slot);
  return config ? slot + " (" + config.start + "~" + config.end + ")" : slot;
}

function initializeVacationSlotProperties() {
  const properties = getScriptProperties();
  const added = [], matching = [], different = [];
  VACATION_SLOTS.forEach(slot => {
    const config = SLOT_PROPERTY_MAP[slot];
    [[config.start, config.defaults[0]], [config.end, config.defaults[1]]].forEach(item => {
      const current = properties.getProperty(item[0]);
      if (!current) { properties.setProperty(item[0], item[1]); added.push(item[0]); }
      else if (current === item[1]) matching.push(item[0]);
      else different.push({ key: item[0], current: current, expected: item[1] });
    });
  });
  return { added: added, matching: matching, different: different };
}

function timeToMinutes(value) {
  const parts = value.split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function getAllSlotTimeConfigs() {
  const configs = {};
  CONSULT_SLOTS.forEach(slot => {
    const config = getSlotTimeConfig(slot);
    if (config) configs[slot] = config;
  });
  return configs;
}

function formatKoreanDateLabel(date) {
  const parsed = new Date(date + "T00:00:00+09:00");
  return Utilities.formatDate(parsed, TIME_ZONE, "yyyy년 M월 d일");
}

function localIsoDate(date) {
  return Utilities.formatDate(date || new Date(), TIME_ZONE, "yyyy-MM-dd");
}

function addDays(date, count) {
  return new Date(date.getTime() + count * 24 * 60 * 60 * 1000);
}

function hasCalendarEventIdHeader(sheet) {
  return sheet && sheet.getRange(1, CALENDAR_EVENT_ID_COLUMN).getValue().toString().trim() === CALENDAR_EVENT_ID_HEADER;
}

function getCalendarConfiguration() {
  const properties = getScriptProperties();
  const enabled = isPropertyEnabled("GOOGLE_CALENDAR_ENABLED");
  const calendarId = properties.getProperty("GOOGLE_CALENDAR_ID") || "";
  return { enabled: enabled, calendarId: calendarId };
}

function getConfiguredCalendar() {
  const config = getCalendarConfiguration();
  if (!config.enabled || !config.calendarId) return null;
  const calendar = CalendarApp.getCalendarById(config.calendarId);
  if (!calendar) throw new Error("CALENDAR_NOT_ACCESSIBLE");
  return calendar;
}

function buildCounselingDateTime(date, time) {
  return new Date(date + "T" + time + ":00+09:00");
}

function createCalendarEventForReservation(rowNumber, date, slot, name) {
  const config = getCalendarConfiguration();
  if (!config.enabled || !config.calendarId) return false;
  const slotTime = getSlotTimeConfig(slot);
  if (!slotTime) return false;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet || !hasCalendarEventIdHeader(sheet)) {
    console.error("Google Calendar sync skipped: G1 must be '" + CALENDAR_EVENT_ID_HEADER + "'.");
    return false;
  }
  if (!rowNumber || rowNumber > sheet.getLastRow()) return false;
  const current = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
  if (current[CALENDAR_EVENT_ID_COLUMN - 1]) return false;
  if (parseKoreanDate(current[0]) !== date || current[1].toString().trim() !== slot || current[2].toString() !== name) return false;

  const calendar = getConfiguredCalendar();
  if (!calendar) return false;
  const event = calendar.createEvent(
    "[학생 상담] " + name,
    buildCounselingDateTime(date, slotTime.start),
    buildCounselingDateTime(date, slotTime.end),
    { description: "상담 시간대: " + formatSlotWithTime(slot) + "\n관리자 페이지: " + getAdminPageUrl() }
  );

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) {
      event.deleteEvent();
      return false;
    }
    const verified = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
    const existingId = verified[CALENDAR_EVENT_ID_COLUMN - 1] ? verified[CALENDAR_EVENT_ID_COLUMN - 1].toString().trim() : "";
    const stillMatches = parseKoreanDate(verified[0]) === date && verified[1].toString().trim() === slot && verified[2].toString() === name;
    if (!stillMatches || existingId) {
      event.deleteEvent();
      return false;
    }
    sheet.getRange(rowNumber, CALENDAR_EVENT_ID_COLUMN).setValue(event.getId());
  } finally {
    lock.releaseLock();
  }
  return true;
}

function createCalendarEventForReservationSafely(rowNumber, date, slot, name) {
  try {
    return createCalendarEventForReservation(rowNumber, date, slot, name);
  } catch (error) {
    console.error("Google Calendar event creation failed.");
    return false;
  }
}

function deleteCalendarEvent(eventId) {
  if (!eventId) return false;
  const calendar = getConfiguredCalendar();
  if (!calendar) return false;
  const event = calendar.getEventById(eventId);
  if (!event) return false;
  event.deleteEvent();
  return true;
}

function deleteCalendarEventSafely(eventId) {
  try {
    return deleteCalendarEvent(eventId);
  } catch (error) {
    console.error("Google Calendar event deletion failed.");
    return false;
  }
}

function updateCalendarCompletionSafely(eventId, name, completed) {
  if (!eventId) return false;
  try {
    const calendar = getConfiguredCalendar();
    if (!calendar) return false;
    const event = calendar.getEventById(eventId);
    if (!event) return false;
    event.setTitle((completed ? "[완료] " : "") + "[학생 상담] " + name);
    return true;
  } catch (error) {
    console.error("Google Calendar completion update failed.");
    return false;
  }
}

function syncExistingReservationsToCalendar() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) throw new Error("SHEET_NOT_FOUND");
  if (!hasCalendarEventIdHeader(sheet)) throw new Error("CALENDAR_EVENT_ID_HEADER_REQUIRED");
  const config = getCalendarConfiguration();
  if (!config.enabled || !config.calendarId) throw new Error("CALENDAR_NOT_CONFIGURED");

  const rows = sheet.getDataRange().getValues();
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 1; i < rows.length; i++) {
    const date = parseKoreanDate(rows[i][0]);
    const slot = rows[i][1] ? rows[i][1].toString().trim() : "";
    const name = rows[i][2] ? rows[i][2].toString() : "";
    if (!date || !name || CONSULT_SLOTS.indexOf(slot) === -1 || rows[i][CALENDAR_EVENT_ID_COLUMN - 1]) {
      skipped++;
      continue;
    }
    try {
      if (createCalendarEventForReservation(i + 1, date, slot, name)) created++;
      else skipped++;
    } catch (error) {
      failed++;
      console.error("Existing reservation Calendar sync failed at row " + (i + 1) + ".");
    }
  }
  return { created: created, skipped: skipped, failed: failed };
}

function readJsonProperty(key) {
  const raw = getScriptProperties().getProperty(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error("Invalid JSON state was reset for " + key + ".");
    return {};
  }
}

function writeJsonProperty(key, value) {
  getScriptProperties().setProperty(key, JSON.stringify(value));
}

function cleanDatedState(state, cutoffDate) {
  Object.keys(state).forEach(key => {
    const dateMatch = key.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch && dateMatch[0] < cutoffDate) delete state[key];
  });
  return state;
}

function getReservationsForDate(date) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).map(row => ({
    date: parseKoreanDate(row[0]),
    slot: row[1] ? row[1].toString().trim() : "",
    name: row[2] ? row[2].toString() : "",
    completed: sheetBoolean(row[4])
  })).filter(item => item.date === date && item.name && CONSULT_SLOTS.indexOf(item.slot) !== -1)
    .sort((a, b) => CONSULT_SLOTS.indexOf(a.slot) - CONSULT_SLOTS.indexOf(b.slot) || a.name.localeCompare(b.name));
}

function sendSlotStartNotification(date, slot, names, testMode) {
  const slotTime = getSlotTimeConfig(slot);
  if (!slotTime || !names.length) return false;
  const titlePrefix = testMode ? "[테스트] " : "";
  return sendDiscordEmbed({
    title: titlePrefix + "🔔 " + slot + " 상담 일정",
    url: getAdminPageUrl(),
    color: 16766720,
    fields: [
      { name: "날짜", value: formatKoreanDateLabel(date), inline: true },
      { name: "시작 시각", value: slotTime.start, inline: true },
      { name: "상담 학생", value: names.map(name => "- " + name).join("\n"), inline: false },
      { name: "전체", value: names.length + "명", inline: true },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function checkCounselingSlotStartNotifications() {
  if (!isPropertyEnabled("DISCORD_SLOT_START_ENABLED")) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    const date = localIsoDate(now);
    const currentMinutes = Number(Utilities.formatDate(now, TIME_ZONE, "H")) * 60 + Number(Utilities.formatDate(now, TIME_ZONE, "m"));
    const reservations = getReservationsForDate(date);
    if (!reservations.length) return false;
    const allowedSlots = getAllowedSlotsForDate(SpreadsheetApp.getActiveSpreadsheet(), date);

    const state = cleanDatedState(readJsonProperty(SLOT_START_STATE_KEY), localIsoDate(addDays(now, -14)));
    let sentAny = false;
    CONSULT_SLOTS.forEach(slot => {
      if (allowedSlots.indexOf(slot) === -1) return;
      const config = getSlotTimeConfig(slot);
      if (!config) return;
      const difference = currentMinutes - timeToMinutes(config.start);
      const key = date + "|" + slot;
      if (difference < 0 || difference > 4 || state[key]) return;
      const names = reservations.filter(item => item.slot === slot).map(item => item.name);
      if (!names.length) return;
      if (sendSlotStartNotification(date, slot, names, false)) {
        state[key] = discordTimestampLabel();
        sentAny = true;
      }
    });
    writeJsonProperty(SLOT_START_STATE_KEY, state);
    return sentAny;
  } finally {
    lock.releaseLock();
  }
}

function testSlotStartNotification() {
  const slot = CONSULT_SLOTS.find(item => getSlotTimeConfig(item));
  if (!slot) return false;
  const todayReservations = getReservationsForDate(localIsoDate(new Date())).filter(item => item.slot === slot);
  const names = todayReservations.length ? todayReservations.map(item => item.name) : ["테스트 학생"];
  return sendSlotStartNotification(localIsoDate(new Date()), slot, names, true);
}

function sendCounselingSummary(date, kind, testMode) {
  const reservations = getReservationsForDate(date);
  const isToday = kind === "today";
  const dateLabel = formatKoreanDateLabel(date);
  const prefix = testMode ? "[테스트] " : "";

  // 예약이 0건이더라도 반드시 안내 메시지 전송
  if (reservations.length === 0) {
    const noItemMsg = isToday
      ? "[안내] 오늘(" + dateLabel + ") 예정된 상담이 없습니다."
      : "[안내] 내일(" + dateLabel + ") 예정된 상담이 없습니다.";
    return sendDiscordMessage(prefix + noItemMsg);
  }

  const lines = reservations.map(item => {
    const completed = isToday ? " · " + (item.completed ? "완료" : "미완료") : "";
    return "- " + item.slot + " · " + item.name + completed;
  }).join("\n");

  return sendDiscordEmbed({
    title: prefix + (isToday ? "📅 오늘의 상담 일정" : "📋 내일의 상담 일정"),
    url: getAdminPageUrl(),
    color: isToday ? 3447003 : 10181046,
    fields: [
      { name: "날짜", value: dateLabel, inline: true },
      { name: "전체 예약", value: reservations.length + "건", inline: true },
      { name: "일정", value: lines, inline: false },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function runDailySummary(kind) {
  if (!isPropertyEnabled("DISCORD_DAILY_SUMMARY_ENABLED")) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    const date = localIsoDate(kind === "today" ? now : addDays(now, 1));
    const key = kind + "|" + date;
    const state = cleanDatedState(readJsonProperty(SUMMARY_STATE_KEY), localIsoDate(addDays(now, -14)));
    if (state[key]) return false;
    if (!sendCounselingSummary(date, kind, false)) return false;
    state[key] = discordTimestampLabel();
    writeJsonProperty(SUMMARY_STATE_KEY, state);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function runTodayCounselingSummary() {
  return runDailySummary("today");
}

function runTomorrowCounselingSummary() {
  return runDailySummary("tomorrow");
}

function testTodayCounselingSummary() {
  return sendCounselingSummary(localIsoDate(new Date()), "today", true);
}

function testTomorrowCounselingSummary() {
  return sendCounselingSummary(localIsoDate(addDays(new Date(), 1)), "tomorrow", true);
}

function removeCounselingTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (COUNSELING_TRIGGER_HANDLERS.indexOf(trigger.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  return removed;
}

function installCounselingTriggers() {
  removeCounselingTriggers();
  ScriptApp.newTrigger("checkCounselingSlotStartNotifications").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("runTodayCounselingSummary").timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone(TIME_ZONE).create();
  ScriptApp.newTrigger("runTomorrowCounselingSummary").timeBased().atHour(19).nearMinute(0).everyDays(1).inTimezone(TIME_ZONE).create();
  return getCounselingTriggerStatus();
}

function getCounselingTriggerStatus() {
  const installed = {};
  COUNSELING_TRIGGER_HANDLERS.forEach(handler => { installed[handler] = false; });
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const handler = trigger.getHandlerFunction();
    if (Object.prototype.hasOwnProperty.call(installed, handler)) installed[handler] = true;
  });
  return installed;
}

function adminRunIntegrationTest(testFunction) {
  try {
    return jsonOutput({ ok: true, sent: Boolean(testFunction()) });
  } catch (error) {
    console.error("Administrator integration test failed.");
    return jsonOutput({ ok: false, error: "INTEGRATION_TEST_FAILED" });
  }
}

function adminGetIntegrationStatus() {
  const properties = getScriptProperties();
  const slotConfigs = getAllSlotTimeConfigs();
  let triggers = {};
  let triggerStatusAvailable = true;
  try {
    triggers = getCounselingTriggerStatus();
  } catch (error) {
    triggerStatusAvailable = false;
    COUNSELING_TRIGGER_HANDLERS.forEach(handler => { triggers[handler] = false; });
    logServerError("Counseling trigger status lookup failed", error);
  }
  return jsonOutput({
    ok: true,
    status: {
      discordConfigured: Boolean(properties.getProperty(DISCORD_WEBHOOK_URL_KEY)),
      slotStartEnabled: isPropertyEnabled("DISCORD_SLOT_START_ENABLED"),
      dailySummaryEnabled: isPropertyEnabled("DISCORD_DAILY_SUMMARY_ENABLED"),
      calendarEnabled: isPropertyEnabled("GOOGLE_CALENDAR_ENABLED"),
      slotTimesValid: Object.keys(slotConfigs).length === CONSULT_SLOTS.length,
      triggersInstalled: triggerStatusAvailable && COUNSELING_TRIGGER_HANDLERS.every(handler => triggers[handler] === true)
    }
  });
}

function incrementCount(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function countMapToArray(counts, preferredOrder) {
  const keys = preferredOrder ? preferredOrder.filter(key => counts[key]) : Object.keys(counts).sort();
  return keys.map(key => ({ label: key, count: counts[key] }));
}

function adminGetCounselingStats(data) {
  const startDate = data.startDate ? data.startDate.toString().trim() : "";
  const endDate = data.endDate ? data.endDate.toString().trim() : "";
  const name = data.name ? data.name.toString().trim() : "";
  const completedFilter = data.completed === true ? true : data.completed === false ? false : null;
  if ((startDate && !isIsoDate(startDate)) || (endDate && !isIsoDate(endDate))) {
    return jsonOutput({ ok: false, error: "INVALID_DATE" });
  }
  if (startDate && endDate && startDate > endDate) return jsonOutput({ ok: false, error: "INVALID_DATE_RANGE" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const rows = sheet.getDataRange().getValues().slice(1).map(row => ({
    date: parseKoreanDate(row[0]),
    slot: row[1] ? row[1].toString().trim() : "",
    name: row[2] ? row[2].toString().trim() : "",
    completed: sheetBoolean(row[4])
  })).filter(item => item.date && item.name)
    .filter(item => !startDate || item.date >= startDate)
    .filter(item => !endDate || item.date <= endDate)
    .filter(item => !name || item.name.indexOf(name) !== -1)
    .filter(item => completedFilter === null || item.completed === completedFilter);

  const now = new Date();
  const today = localIsoDate(now);
  const jsDay = new Date(today + "T00:00:00+09:00").getDay();
  const day = jsDay === 0 ? 7 : jsDay;
  const weekStart = localIsoDate(addDays(now, 1 - day));
  const weekEnd = localIsoDate(addDays(now, 7 - day));
  const month = today.substring(0, 7);
  const completed = rows.filter(item => item.completed).length;
  const studentCounts = {};
  const dateCounts = {};
  const weekdayCounts = {};
  const slotCounts = {};
  const monthCounts = {};
  const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];
  rows.forEach(item => {
    incrementCount(studentCounts, item.name);
    incrementCount(dateCounts, item.date);
    const rowJsDay = new Date(item.date + "T00:00:00+09:00").getDay();
    const weekdayIndex = (rowJsDay === 0 ? 7 : rowJsDay) - 1;
    incrementCount(weekdayCounts, weekdayLabels[weekdayIndex]);
    incrementCount(slotCounts, item.slot || "미지정");
    incrementCount(monthCounts, item.date.substring(0, 7));
  });

  return jsonOutput({
    ok: true,
    stats: {
      summary: {
        today: rows.filter(item => item.date === today).length,
        week: rows.filter(item => item.date >= weekStart && item.date <= weekEnd).length,
        month: rows.filter(item => item.date.substring(0, 7) === month).length,
        completed: completed,
        incomplete: rows.length - completed,
        completionRate: rows.length ? Math.round(completed * 1000 / rows.length) / 10 : 0,
        total: rows.length
      },
      byStudent: countMapToArray(studentCounts),
      byDate: countMapToArray(dateCounts),
      byWeekday: countMapToArray(weekdayCounts, weekdayLabels),
      bySlot: countMapToArray(slotCounts, CONSULT_SLOTS.concat(["미지정"])),
      byMonth: countMapToArray(monthCounts)
    }
  });
}
