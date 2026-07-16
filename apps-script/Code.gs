const CONSULT_SHEET_NAME = "상담신청현황";
const CALENDAR_SHEET_NAME = "학사일정";
const AVAILABILITY_SHEET_NAME = "상담가능시간";
const BLOCKED_PERIOD_TITLE = "상담불가";
const CONSULT_SLOTS = ["야자 1차시", "야자 2차시", "야자 3차시"];
const ADMIN_PASSWORD_HASH_KEY = "ADMIN_PASSWORD_HASH";
const ADMIN_PASSWORD_SALT_KEY = "ADMIN_PASSWORD_SALT";
const ADMIN_AUTH_VERSION_KEY = "ADMIN_AUTH_VERSION";
const ADMIN_PASSWORD_SETUP_KEY = "ADMIN_PASSWORD_SETUP";
const ADMIN_SESSION_PREFIX = "ADMIN_SESSION_";
const ADMIN_SESSION_TTL_SECONDS = 30 * 60;
const DISCORD_WEBHOOK_URL_KEY = "DISCORD_WEBHOOK_URL";
const ADMIN_PAGE_URL_KEY = "ADMIN_PAGE_URL";

function textOutput(value) {
  return ContentService.createTextOutput(value).setMimeType(ContentService.MimeType.TEXT);
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function getScriptProperties() {
  return PropertiesService.getScriptProperties();
}

function sendDiscordMessage(message) {
  const webhookUrl = getScriptProperties().getProperty(DISCORD_WEBHOOK_URL_KEY);
  if (!webhookUrl) {
    console.error("Discord notification skipped: DISCORD_WEBHOOK_URL is not configured.");
    return false;
  }

  try {
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        content: message,
        allowed_mentions: { parse: [] }
      }),
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

function notifyDiscordReservation(name, date, slot) {
  const adminPageUrl = getScriptProperties().getProperty(ADMIN_PAGE_URL_KEY);
  if (!adminPageUrl) {
    console.error("Discord reservation notification skipped: ADMIN_PAGE_URL is not configured.");
    return false;
  }
  return sendDiscordMessage([
    "📅 **상담 예약 알림**",
    "학생: " + name,
    "날짜: " + date,
    "시간: " + slot,
    "관리자 페이지: " + adminPageUrl
  ].join("\n"));
}

function notifyDiscordCancellation(name, date, slot) {
  return sendDiscordMessage([
    "❌ **상담 예약 취소 알림**",
    "학생: " + name,
    "날짜: " + date,
    "시간: " + slot
  ].join("\n"));
}

function testDiscordNotification() {
  return sendDiscordMessage("🔔 상담 예약 시스템 Discord Webhook 테스트 알림입니다.");
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

function getAvailabilityMap(ss) {
  const sheet = ss.getSheetByName(AVAILABILITY_SHEET_NAME);
  const availability = {};
  if (!sheet) return availability;

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    availability[date] = {
      "야자 1차시": sheetBoolean(rows[i][1]),
      "야자 2차시": sheetBoolean(rows[i][2]),
      "야자 3차시": sheetBoolean(rows[i][3])
    };
  }
  return availability;
}

function isDateBlocked(ss, date) {
  const sheet = ss.getSheetByName(CALENDAR_SHEET_NAME);
  if (!sheet) return false;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const startDate = parseKoreanDate(rows[i][0]);
    const endDate = rows[i][1] ? parseKoreanDate(rows[i][1]) : startDate;
    if (startDate && endDate && date >= startDate && date <= endDate) return true;
  }
  return false;
}

function doGet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];
  
  const sheet1 = ss.getSheetByName("상담신청현황"); 
  const data1 = sheet1 ? sheet1.getDataRange().getValues() : [];
  
  // 🎨 [수정됨] 쨍한 색을 빼고 부드러운 파스텔톤으로 완벽 통일!
  const slotColors = { 
    "야자 1차시": "#d0c3fa", // 차분한 파스텔 연보라
    "야자 2차시": "#b5ead7", // 눈이 편안한 파스텔 민트
    "야자 3차시": "#ffeaa7"  // 따뜻한 파스텔 노랑
  };
  const defaultColor = "#caffbf"; 

  for (let i = 1; i < data1.length; i++) {
    if(data1[i][0]) {
      const fmtDate = parseKoreanDate(data1[i][0]); 
      if (!fmtDate) continue; 
      const slot = data1[i][1] ? data1[i][1].toString().trim() : "";
      const color = slotColors[slot] || defaultColor;
      
      results.push({ 
        title: data1[i][2], 
        start: fmtDate, 
        allDay: true, 
        backgroundColor: color, 
        borderColor: color, 
        textColor: "#495057", 
        extendedProps: { slot: slot, name: data1[i][2], type: "consult" } 
      });
    }
  }

  const sheet2 = ss.getSheetByName("학사일정");
  const holidays = [];
  if (sheet2) {
    const holidayData = sheet2.getDataRange().getValues();
    for (var j = 1; j < holidayData.length; j++) {
      const startDateVal = holidayData[j][0];
      const endDateVal = holidayData[j][1]; 
      const hTitle = holidayData[j][2] || "상담불가"; 
      
      if (startDateVal) {
        const startFmt = parseKoreanDate(startDateVal);
        const endFmt = endDateVal ? parseKoreanDate(endDateVal) : startFmt; 
        if (startFmt && endFmt) {
          const rangeDates = getDatesStartToIn(startFmt, endFmt);
          holidays.push(...rangeDates);
          let calendarEnd = new Date(endFmt);
          calendarEnd.setDate(calendarEnd.getDate() + 1);
          const calendarEndStr = Utilities.formatDate(calendarEnd, "GMT+9", "yyyy-MM-dd");
          
          results.push({
            title: "🚫 " + hTitle + " 🚫", 
            start: startFmt, end: calendarEndStr, allDay: true,
            backgroundColor: "#e8e6f2", borderColor: "#e8e6f2", textColor: "#5a5570",
            extendedProps: { type: "holiday" }
          });
        }
      }
    }
  }
  return jsonOutput({
    events: results,
    holidays: [...new Set(holidays)],
    availability: getAvailabilityMap(ss)
  });
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (error) {
    return textOutput("INVALID_REQUEST");
  }

  if (data.action && data.action.indexOf("admin") === 0) {
    try {
      return handleAdminAction(data);
    } catch (error) {
      console.error("Admin action failed", data.action, error);
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
    let reservationSaved = false;
    lock.waitLock(10000);
    try {
      if (isDateBlocked(ss, date)) return textOutput("DATE_BLOCKED");

      const availability = getAvailabilityMap(ss);
      if (availability[date] && availability[date][slot] !== true) {
        return textOutput("SLOT_UNAVAILABLE");
      }

      const rows = sheet.getDataRange().getValues();
      const slotTaken = rows.slice(1).some(row => {
        return parseKoreanDate(row[0]) === date &&
          (row[1] ? row[1].toString().trim() : "") === slot;
      });
      if (slotTaken) return textOutput("SLOT_TAKEN");

      const reqDate = new Date(date + "T00:00:00+09:00");
      const day = reqDate.getDay();
      const mondayDiff = day === 0 ? -6 : 1 - day;
      const mon = new Date(reqDate); mon.setDate(reqDate.getDate() + mondayDiff); mon.setHours(0,0,0,0);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);

      const isDuplicate = rows.slice(1).some(row => {
        const rowDate = parseKoreanDate(row[0]);
        const sDate = rowDate ? new Date(rowDate + "T00:00:00+09:00").getTime() : NaN;
        const rowName = row[2] ? row[2].toString().trim() : "";
        return rowName === trimmedName && sDate >= mon.getTime() && sDate <= sun.getTime();
      });
      if (isDuplicate) return textOutput("DUPLICATE_WEEKLY");

      sheet.appendRow([date, slot, trimmedName, trimmedPwd]);
      reservationSaved = true;
    } finally {
      lock.releaseLock();
    }
    if (reservationSaved) notifyDiscordReservation(trimmedName, date, slot);
    return textOutput("Success");
  } else if (action === "delete") {
    const lock = LockService.getScriptLock();
    let deleteResult = "NOT_FOUND";
    lock.waitLock(10000);
    try {
      const rows = sheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        const rDate = Utilities.formatDate(new Date(rows[i][0]), "GMT+9", "yyyy-MM-dd");
        if (rDate === date && rows[i][1] === slot && rows[i][2] === trimmedName) {
          const savedPwd = rows[i][3] ? rows[i][3].toString().trim() : "";
          if (verifyAdminPassword(trimmedPwd) || trimmedPwd === savedPwd) {
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
    if (deleteResult === "Success") notifyDiscordCancellation(trimmedName, date, slot);
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
  if (data.action === "adminListReservations") return adminListReservations();
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

  return jsonOutput({ ok: false, error: "INVALID_ACTION" });
}

function adminListReservations() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });

  const rows = sheet.getDataRange().getValues();
  const reservations = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    reservations.push({
      row: i + 1,
      date: date,
      slot: rows[i][1] ? rows[i][1].toString().trim() : "",
      name: rows[i][2] ? rows[i][2].toString() : "",
      completed: sheetBoolean(rows[i][4]),
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
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const row = sheet.getRange(rowNumber, 1, 1, 4).getValues()[0];
    const currentDate = parseKoreanDate(row[0]);
    const currentSlot = row[1] ? row[1].toString().trim() : "";
    const currentName = row[2] ? row[2].toString() : "";

    if (currentDate !== data.date || currentSlot !== data.slot || currentName !== data.name) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    sheet.deleteRow(rowNumber);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
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
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
    const row = sheet.getRange(rowNumber, 1, 1, 6).getValues()[0];
    const currentDate = parseKoreanDate(row[0]);
    const currentSlot = row[1] ? row[1].toString().trim() : "";
    const currentName = row[2] ? row[2].toString() : "";
    if (currentDate !== data.date || currentSlot !== data.slot || currentName !== data.name) {
      return jsonOutput({ ok: false, error: "STALE_DATA" });
    }

    sheet.getRange(rowNumber, 5, 1, 2).setValues([[data.completed, memo]]);
    return jsonOutput({ ok: true });
  } finally {
    lock.releaseLock();
  }
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

  const rows = sheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const date = parseKoreanDate(rows[i][0]);
    if (!date) continue;
    items.push({
      row: i + 1,
      date: date,
      slots: [sheetBoolean(rows[i][1]), sheetBoolean(rows[i][2]), sheetBoolean(rows[i][3])]
    });
  }
  items.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return jsonOutput({ ok: true, items: items });
}

function validateAvailabilityInput(data) {
  const date = data.date ? data.date.toString().trim() : "";
  if (!isIsoDate(date)) return { ok: false, error: "INVALID_DATE" };
  if (!Array.isArray(data.slots) || data.slots.length !== CONSULT_SLOTS.length ||
      data.slots.some(value => typeof value !== "boolean")) {
    return { ok: false, error: "INVALID_AVAILABILITY" };
  }
  return { ok: true, date: date, slots: data.slots };
}

function adminSetAvailability(data) {
  const input = validateAvailabilityInput(data);
  if (!input.ok) return jsonOutput(input);
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "AVAILABILITY_SHEET_NOT_FOUND" });
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
      sheet.appendRow([input.date].concat(input.slots));
    } else {
      if (rowNumber > sheet.getLastRow()) return jsonOutput({ ok: false, error: "STALE_DATA" });
      const currentDate = parseKoreanDate(sheet.getRange(rowNumber, 1).getValue());
      if (currentDate !== data.expectedDate) return jsonOutput({ ok: false, error: "STALE_DATA" });
      const duplicate = rows.slice(1).some((row, index) => index + 2 !== rowNumber && parseKoreanDate(row[0]) === input.date);
      if (duplicate) return jsonOutput({ ok: false, error: "AVAILABILITY_EXISTS" });
      sheet.getRange(rowNumber, 1, 1, 4).setValues([[input.date].concat(input.slots)]);
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
      kind: !rawTitle || rawTitle === BLOCKED_PERIOD_TITLE ? "blocked" : "academic"
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
