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
const CHANGE_RESERVATION_ENABLED_KEY = "CHANGE_RESERVATION_ENABLED";
const DEFAULT_ADMIN_PAGE_URL = "https://khj-hub.github.io/1-1-counseling/admin.html";
const TIME_ZONE = "Asia/Seoul";
const CALENDAR_EVENT_ID_COLUMN = 7;
const CALENDAR_EVENT_ID_HEADER = "Calendar Event ID";
const SLOT_START_STATE_KEY = "COUNSELING_SLOT_START_STATE";
const SUMMARY_STATE_KEY = "COUNSELING_SUMMARY_STATE";
const ADMIN_CHANGE_REMINDER_STATE_KEY = "COUNSELING_ADMIN_CHANGE_REMINDER_STATE";
const ADMIN_CHANGE_REMINDER_ENABLED_KEY = "DISCORD_ADMIN_CHANGE_REMINDER_ENABLED";
const OPERATION_SETTINGS_KEY = "COUNSELING_OPERATION_SETTINGS";
const BACKUP_SOURCE_SHEET_NAMES = [CONSULT_SHEET_NAME, AVAILABILITY_SHEET_NAME, CALENDAR_SHEET_NAME];
const COUNSELING_TRIGGER_HANDLERS = [
  "checkCounselingSlotStartNotifications",
  "runTodayCounselingSummary",
  "runTomorrowCounselingSummary",
  "runTodayAdminChangeReminder"
];
// 이전 정책에서 만들어졌을 수 있는 트리거까지 안전하게 정리한다.
// 현재 자동 발송 정책은 당일 아침 요약만 사용한다.
const REQUIRED_COUNSELING_TRIGGER_HANDLERS = ["runTodayCounselingSummary", "runTodayAdminChangeReminder"];
const MORNING_SUMMARY_TRIGGER_HANDLER = "runTodayCounselingSummary";
const MORNING_SUMMARY_TRIGGER_SCHEDULE_LABEL = "매일 오전 8시대 (정각 기준 약 ±15분 오차 가능)";
const ADMIN_CHANGE_REMINDER_TRIGGER_HANDLER = "runTodayAdminChangeReminder";
const ADMIN_CHANGE_REMINDER_TRIGGER_SCHEDULE_LABEL = "매일 오후 4시대 (정각 기준 약 ±15분 오차 가능)";
const SLOT_PROPERTY_MAP = {
  "야자 1차시": { start: "SLOT_1_START", end: "SLOT_1_END" },
  "야자 2차시": { start: "SLOT_2_START", end: "SLOT_2_END" },
  "야자 3차시": { start: "SLOT_3_START", end: "SLOT_3_END" },
  "자습 1차시": { start: "VACATION_SLOT_1_START", end: "VACATION_SLOT_1_END", defaults: VACATION_SLOT_DEFAULTS[0] },
  "자습 2차시": { start: "VACATION_SLOT_2_START", end: "VACATION_SLOT_2_END", defaults: VACATION_SLOT_DEFAULTS[1] },
  "자습 3차시": { start: "VACATION_SLOT_3_START", end: "VACATION_SLOT_3_END", defaults: VACATION_SLOT_DEFAULTS[2] },
  "자습 4차시": { start: "VACATION_SLOT_4_START", end: "VACATION_SLOT_4_END", defaults: VACATION_SLOT_DEFAULTS[3] }
};

function getDefaultOperationSettings() {
  return {
    schoolYear: 2026,
    className: "1학년 1반",
    studentTitle: "1학년 1반 상담 신청",
    adminTitle: "교사용 상담 관리",
    operating: true,
    studentNotice: "편한 날짜와 시간을 골라 상담을 신청해 주세요.",
    vacationNotice: "방학 중에는 선생님이 열어둔 날짜와 시간만 신청할 수 있어요.",
    passwordNotice: "예약 취소 시 사용할 숫자 4자리를 입력해 주세요.",
    periods: [
      { id: "default-summer-2026", name: "여름방학", startDate: "2026-07-21", endDate: "2026-08-17", operationType: "vacation" }
    ],
    schoolStartDate: "2026-08-18",
    slotTimes: {}
  };
}

function getOperationSettings() {
  const defaults = getDefaultOperationSettings();
  const raw = getScriptProperties().getProperty(OPERATION_SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    return Object.assign({}, defaults, saved, {
      periods: Array.isArray(saved.periods) ? saved.periods : defaults.periods,
      slotTimes: saved.slotTimes && typeof saved.slotTimes === "object" && !Array.isArray(saved.slotTimes) ? saved.slotTimes : {}
    });
  } catch (error) {
    logServerError("Operation settings parse failed", error);
    return defaults;
  }
}

function getConfiguredPeriod(date, settings) {
  const periods = (settings || getOperationSettings()).periods || [];
  for (let i = periods.length - 1; i >= 0; i--) {
    const period = periods[i];
    if (period && period.startDate <= date && date <= period.endDate) return period;
  }
  return null;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
}

function validateOperationSettings(data) {
  const input = data && data.settings;
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "INVALID_SETTINGS" };
  const schoolYear = Number(input.schoolYear);
  const className = (input.className || "").toString().trim();
  const studentTitle = (input.studentTitle || "").toString().trim();
  const adminTitle = (input.adminTitle || "").toString().trim();
  const studentNotice = (input.studentNotice || "").toString().trim();
  const vacationNotice = (input.vacationNotice || "").toString().trim();
  const passwordNotice = (input.passwordNotice || "").toString().trim();
  if (!Number.isInteger(schoolYear) || schoolYear < 2000 || schoolYear > 2200 || !className || !studentTitle || !adminTitle) {
    return { ok: false, error: "INVALID_SETTINGS" };
  }
  if ([className, studentTitle, adminTitle].some(value => value.length > 100) ||
      [studentNotice, vacationNotice, passwordNotice].some(value => value.length > 300)) {
    return { ok: false, error: "SETTINGS_TOO_LONG" };
  }

  const periods = Array.isArray(input.periods) ? input.periods : [];
  if (periods.length > 30) return { ok: false, error: "SETTINGS_TOO_LONG" };
  const normalizedPeriods = [];
  for (let i = 0; i < periods.length; i++) {
    const item = periods[i] || {};
    const name = (item.name || "").toString().trim();
    const startDate = (item.startDate || "").toString().trim();
    const endDate = (item.endDate || "").toString().trim();
    const operationType = normalizeOperationType(item.operationType);
    if (!name || name.length > 100 || !isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate ||
        OPERATION_TYPES.indexOf(operationType) === -1) {
      return { ok: false, error: "INVALID_PERIOD" };
    }
    normalizedPeriods.push({
      id: (item.id || Utilities.getUuid()).toString().substring(0, 100),
      name: name,
      startDate: startDate,
      endDate: endDate,
      operationType: operationType
    });
  }

  const slotTimes = {};
  const rawSlotTimes = input.slotTimes && typeof input.slotTimes === "object" ? input.slotTimes : {};
  for (let i = 0; i < CONSULT_SLOTS.length; i++) {
    const slot = CONSULT_SLOTS[i];
    const value = rawSlotTimes[slot];
    if (!value) continue;
    const start = (value.start || "").toString().trim();
    const end = (value.end || "").toString().trim();
    if (!start && !end) continue;
    if (!isValidTime(start) || !isValidTime(end) || timeToMinutes(end) <= timeToMinutes(start)) {
      return { ok: false, error: "INVALID_SLOT_TIME" };
    }
    slotTimes[slot] = { start: start, end: end };
  }

  const schoolStartDate = (input.schoolStartDate || "").toString().trim();
  if (schoolStartDate && !isIsoDate(schoolStartDate)) return { ok: false, error: "INVALID_DATE" };
  const normalizedSettings = {
    schoolYear: schoolYear,
    className: className,
    studentTitle: studentTitle,
    adminTitle: adminTitle,
    operating: input.operating !== false,
    studentNotice: studentNotice,
    vacationNotice: vacationNotice,
    passwordNotice: passwordNotice,
    periods: normalizedPeriods,
    schoolStartDate: schoolStartDate,
    slotTimes: slotTimes
  };
  if (JSON.stringify(normalizedSettings).length > 8000) return { ok: false, error: "SETTINGS_TOO_LONG" };
  return {
    ok: true,
    settings: normalizedSettings
  };
}

function normalizeHolidayTitle(title) {
  return (title || "").toString()
    .replace(/🚫/g, "")
    .replace(/\s+/g, "")
    .replace(/[·.ㆍ]/g, "")
    .trim();
}

// 학교 운영 정책상 기념일은 법정공휴일 자동 표시·예약 차단 대상이 아니다.
function isSchoolPolicyMemorialTitle(title) {
  const normalized = normalizeHolidayTitle(title);
  return /^(?:국군의날|식목일|노동절|근로자의날|스승의날)$/.test(normalized);
}

// Google 한국 공휴일 캘린더에는 기념일도 포함될 수 있으므로 법정·대체공휴일만 사용한다.
function isSchoolPolicyPublicHolidayTitle(title) {
  const normalized = normalizeHolidayTitle(title);
  if (!normalized || isSchoolPolicyMemorialTitle(normalized)) return false;
  // '크리스마스' 부분 문자열만으로 판별하면 크리스마스 이브/전야도 법정공휴일로 오인된다.
  if (/크리스마스(?:이브|전야)/.test(normalized)) return false;
  return /(?:새해첫날|신정|설날|설연휴|삼일절|31절|제헌절|어린이날|부처님오신날|석가탄신일|현충일|광복절|추석|추석연휴|개천절|한글날|크리스마스|성탄절|기독탄신일|대체공휴일|대체휴일|임시공휴일|대통령선거|국회의원선거|지방선거|선거일)/.test(normalized);
}

function filterSchoolPolicyHolidays(holidays) {
  const filtered = {};
  Object.keys(holidays || {}).forEach(date => {
    if (isSchoolPolicyPublicHolidayTitle(holidays[date])) filtered[date] = holidays[date];
  });
  return filtered;
}

// 일부 외부 캘린더가 2026년 공휴일 개정 내용을 늦게 반영하는 경우를 보완한다.
function applySchoolPolicyHolidaySupplements(year, holidays) {
  const supplemented = filterSchoolPolicyHolidays(holidays);
  if (Number(year) >= 2026) supplemented[year + "-07-17"] = "제헌절";
  return supplemented;
}

function getKoreanHolidays(year) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "HOLIDAYS_" + year;
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    try {
      const cachedHolidays = applySchoolPolicyHolidaySupplements(year, JSON.parse(cachedData));
      // 이전 버전이 저장한 기념일 캐시도 즉시 학교 운영 정책에 맞춰 정리한다.
      cache.put(cacheKey, JSON.stringify(cachedHolidays), 21600);
      return cachedHolidays;
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
        if (isSchoolPolicyPublicHolidayTitle(event.getTitle())) {
          holidays[dateStr] = event.getTitle();
        }
      });
      cache.put(cacheKey, JSON.stringify(applySchoolPolicyHolidaySupplements(year, holidays)), 21600);
    }
  } catch(error) {
    console.error("Failed to fetch holidays for year " + year + ": " + error);
  }

  if (Object.keys(holidays).length === 0) {
    try {
      const icsUrl = "https://calendar.google.com/calendar/ical/" + encodeURIComponent(calendarId) + "/public/basic.ics";
      const response = UrlFetchApp.fetch(icsUrl, { muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        const content = response.getContentText().replace(/\r?\n[ \t]/g, "");
        const events = content.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
        events.forEach(eventText => {
          const dateMatch = eventText.match(/^DTSTART(?:;VALUE=DATE)?:(\d{8})/m);
          const titleMatch = eventText.match(/^SUMMARY:(.*)$/m);
          if (!dateMatch || dateMatch[1].substring(0, 4) !== String(year)) return;
          const rawDate = dateMatch[1];
          const dateStr = rawDate.substring(0, 4) + "-" + rawDate.substring(4, 6) + "-" + rawDate.substring(6, 8);
          const title = titleMatch ? titleMatch[1].replace(/\\([,;\\])/g, "$1").trim() : "공휴일";
          if (isSchoolPolicyPublicHolidayTitle(title)) holidays[dateStr] = title;
        });
        if (Object.keys(holidays).length > 0) cache.put(cacheKey, JSON.stringify(applySchoolPolicyHolidaySupplements(year, holidays)), 21600);
      } else {
        console.error("Holiday ICS request failed for year " + year + ": HTTP " + response.getResponseCode());
      }
    } catch(error) {
      console.error("Failed to fetch holiday ICS for year " + year + ": " + error);
    }
  }
  
  return applySchoolPolicyHolidaySupplements(year, holidays);
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

function isChangeReservationEnabled() {
  return (getScriptProperties().getProperty(CHANGE_RESERVATION_ENABLED_KEY) || "true").toLowerCase() !== "false";
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

function notifyDiscordReservationChange(name, oldDate, oldSlot, newDate, newSlot, changedBy) {
  const fields = [
    { name: "학생 이름", value: name, inline: true },
    { name: "기존 예약", value: oldDate + " · " + formatSlotWithTime(oldSlot), inline: false },
    { name: "변경 예약", value: newDate + " · " + formatSlotWithTime(newSlot), inline: false }
  ];
  if (changedBy) fields.push({ name: "변경 주체", value: changedBy, inline: true });
  fields.push(
    { name: "변경 시각", value: discordTimestampLabel(), inline: false },
    { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
  );
  return sendDiscordEmbed({
    title: "🔄 상담 예약 변경",
    url: getAdminPageUrl(),
    color: 10181046,
    fields: fields
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

function notifyDiscordReservationChangeSafely(name, oldDate, oldSlot, newDate, newSlot, changedBy) {
  try {
    notifyDiscordReservationChange(name, oldDate, oldSlot, newDate, newSlot, changedBy);
  } catch (error) {
    console.error("Discord reservation change notification failed.");
  }
}

function isAdminChangeReminderEnabled() {
  const raw = getScriptProperties().getProperty(ADMIN_CHANGE_REMINDER_ENABLED_KEY);
  return raw === null || raw === "" || raw.toLowerCase() === "true";
}

function recordTodayAdminReservationChangeReminder(change) {
  if (!isAdminChangeReminderEnabled() || change.oldDate !== localIsoDate(new Date())) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const state = cleanDatedState(readJsonProperty(ADMIN_CHANGE_REMINDER_STATE_KEY), localIsoDate(addDays(new Date(), -14)));
    const key = change.oldDate + "|row:" + change.rowNumber;
    const existing = state[key];
    if (existing && existing.sentAt) return;
    state[key] = Object.assign({}, existing || {}, {
      name: change.name,
      oldDate: existing && existing.oldDate ? existing.oldDate : change.oldDate,
      oldSlot: existing && existing.oldSlot ? existing.oldSlot : change.oldSlot,
      newDate: change.newDate,
      newSlot: change.newSlot,
      rowNumber: change.rowNumber,
      recordedAt: discordTimestampLabel(),
      sentAt: ""
    });
    writeJsonProperty(ADMIN_CHANGE_REMINDER_STATE_KEY, state);
  } catch (error) {
    console.error("Today admin reservation change reminder recording failed.");
  } finally {
    lock.releaseLock();
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
  if (kind === "academic" && isAutoPublicHolidayTitle(title)) {
    return { ok: false, error: "PUBLIC_HOLIDAY_MANAGED_AUTOMATICALLY" };
  }
  if (kind === "academic" && isSchoolPolicyMemorialTitle(title)) {
    return { ok: false, error: "MEMORIAL_NOT_MANAGED_AS_HOLIDAY" };
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

function getOperationTypeLabel(value) {
  if (value === "vacation") return "방학";
  if (value === "closed") return "상담 불가";
  return "학기 중";
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

function isAutoPublicHolidayTitle(title) {
  return isSchoolPolicyPublicHolidayTitle(title);
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
    if (isAutoPublicHolidayTitle(rows[i][2]) || isSchoolPolicyMemorialTitle(rows[i][2])) continue;
    if (isVacationTitle(rows[i][2])) state.vacation = true;
    else state.blocked = true;
  }
  return state;
}

function getDateOperation(ss, date) {
  const setting = getAvailabilitySettings(ss)[date];
  if (setting) return setting;
  const configuredPeriod = getConfiguredPeriod(date);
  if (configuredPeriod) {
    if (configuredPeriod.operationType === "semester") {
      const semesterSlots = {}; SEMESTER_SLOTS.forEach(slot => { semesterSlots[slot] = true; });
      return { operationType: "semester", slots: semesterSlots, note: configuredPeriod.name };
    }
    return { operationType: configuredPeriod.operationType, slots: {}, note: configuredPeriod.name };
  }
  const academic = getAcademicDateState(ss, date);
  if (academic.vacation) return { operationType: "vacation", slots: {}, note: "" };
  const slots = {}; SEMESTER_SLOTS.forEach(slot => { slots[slot] = true; });
  return { operationType: "semester", slots: slots, note: "" };
}

function getAllowedSlotsForDate(ss, date) {
  if (getOperationSettings().operating === false) return [];
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
  const operationSettings = getOperationSettings();
  
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
      if (isAutoPublicHolidayTitle(hTitle) || isSchoolPolicyMemorialTitle(hTitle)) continue;

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

  // ─── 2단계: 구글 캘린더 공휴일 → 학교 일정과 독립적으로 하루씩 표시 ───
  const currentYear = new Date().getFullYear();
  const krHolidays = Object.assign({}, getKoreanHolidays(currentYear), getKoreanHolidays(currentYear + 1));
  const publicHolidays = Object.keys(krHolidays);
  for (const date in krHolidays) {
    holidays.push(date);
    let calendarEnd = new Date(date + "T00:00:00+09:00");
    calendarEnd.setDate(calendarEnd.getDate() + 1);
    const calendarEndStr = Utilities.formatDate(calendarEnd, "GMT+9", "yyyy-MM-dd");

    results.push({
      title: "🚫 " + krHolidays[date] + " 🚫",
      start: date, end: calendarEndStr, allDay: true,
      backgroundColor: "#e8e6f2", borderColor: "#e8e6f2", textColor: "#5a5570",
      extendedProps: { type: "holiday", reason: krHolidays[date], isPublicHoliday: true }
    });
  }

  const availabilitySettings = getAvailabilitySettings(ss);
  const operationTypes = {};
  const availabilityNotes = {};
  (operationSettings.periods || []).forEach(period => {
    getDatesStartToIn(period.startDate, period.endDate).forEach(date => {
      operationTypes[date] = period.operationType;
      availabilityNotes[date] = period.name;
      if (period.operationType === "vacation" && vacationDates.indexOf(date) === -1) vacationDates.push(date);
    });
  });
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
    slotTimes: slotTimes,
    serviceSettings: {
      schoolYear: operationSettings.schoolYear,
      className: operationSettings.className,
      studentTitle: operationSettings.studentTitle,
      operating: operationSettings.operating,
      studentNotice: operationSettings.studentNotice,
      vacationNotice: operationSettings.vacationNotice,
      passwordNotice: operationSettings.passwordNotice
    }
  });
}

function isPastOrStartedCounselingSlot(date, slot) {
  const today = localIsoDate(new Date());
  if (date < today) return true;
  if (date !== today) return false;
  const slotTime = getSlotTimeConfig(slot);
  if (!slotTime) return false;
  const now = Utilities.formatDate(new Date(), TIME_ZONE, "HH:mm");
  return slotTime.start <= now;
}

function getReservationChangeValidationError(ss, date, slot) {
  if (!isIsoDate(date)) return "INVALID_DATE";
  if (CONSULT_SLOTS.indexOf(slot) === -1) return "INVALID_SLOT";
  const requestDate = new Date(date + "T00:00:00+09:00");
  const day = requestDate.getDay();
  if (date < localIsoDate(new Date())) return "PAST_DATE_NOT_ALLOWED";
  if (day === 0 || day === 6) return "WEEKEND_NOT_ALLOWED";
  const holidays = getKoreanHolidays(requestDate.getFullYear());
  if (holidays[date]) return "HOLIDAY_NOT_ALLOWED:" + holidays[date];
  if (isDateBlocked(ss, date)) return "DATE_BLOCKED";
  if (getAllowedSlotsForDate(ss, date).indexOf(slot) === -1) return "SLOT_UNAVAILABLE";
  if (isPastOrStartedCounselingSlot(date, slot)) return "SLOT_UNAVAILABLE";
  return "";
}

function findReservationsForChange(sheet, name, password) {
  const rows = sheet.getDataRange().getValues();
  const matches = [];
  let completedMatch = false;
  for (let i = 1; i < rows.length; i++) {
    const rowName = rows[i][2] ? rows[i][2].toString().trim() : "";
    const savedPassword = rows[i][3] ? rows[i][3].toString().trim() : "";
    if (rowName !== name || savedPassword !== password) continue;
    if (sheetBoolean(rows[i][4])) {
      completedMatch = true;
      continue;
    }
    const date = parseKoreanDate(rows[i][0]);
    const slot = rows[i][1] ? rows[i][1].toString().trim() : "";
    if (!date || CONSULT_SLOTS.indexOf(slot) === -1) continue;
    matches.push({ row: i + 1, date: date, slot: slot });
  }
  return { reservations: matches, completedMatch: completedMatch };
}

function findReservationForChange(data, sheet) {
  if (!isChangeReservationEnabled()) return jsonOutput({ ok: false, error: "CHANGE_RESERVATION_DISABLED" });
  const name = data.name ? data.name.toString().trim() : "";
  const password = data.password ? data.password.toString().trim() : "";
  if (!name || !/^\d{4}$/.test(password)) return jsonOutput({ ok: false, error: "NOT_FOUND" });
  const result = findReservationsForChange(sheet, name, password);
  if (!result.reservations.length) {
    return jsonOutput({ ok: false, error: result.completedMatch ? "COMPLETED_RESERVATION" : "NOT_FOUND" });
  }
  return jsonOutput({ ok: true, reservations: result.reservations });
}

function isReservationSlotTaken(sheet, date, slot, excludedRow) {
  return sheet.getDataRange().getValues().slice(1).some((candidate, index) => {
    return index + 2 !== excludedRow && parseKoreanDate(candidate[0]) === date &&
      (candidate[1] ? candidate[1].toString().trim() : "") === slot;
  });
}

function hasWeeklyReservationConflict(rows, name, date, excludedRow) {
  const requestDate = new Date(date + "T00:00:00+09:00");
  const day = requestDate.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(requestDate); monday.setDate(requestDate.getDate() + mondayDiff); monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23, 59, 59, 999);
  return rows.slice(1).some((candidate, index) => {
    if (index + 2 === excludedRow) return false;
    const candidateDate = parseKoreanDate(candidate[0]);
    const candidateTime = candidateDate ? new Date(candidateDate + "T00:00:00+09:00").getTime() : NaN;
    const candidateName = candidate[2] ? candidate[2].toString().trim() : "";
    return candidateName === name && candidateTime >= monday.getTime() && candidateTime <= sunday.getTime();
  });
}

function changeReservation(data, ss, sheet, changedBy) {
  if (!isChangeReservationEnabled()) return "CHANGE_RESERVATION_DISABLED";
  if (getOperationSettings().operating === false) return "SERVICE_PAUSED";

  const name = data.name ? data.name.toString().trim() : "";
  const password = data.password ? data.password.toString().trim() : "";
  const oldDate = data.oldDate ? data.oldDate.toString().trim() : "";
  const oldSlot = data.oldSlot ? data.oldSlot.toString().trim() : "";
  const newDate = data.newDate ? data.newDate.toString().trim() : "";
  const newSlot = data.newSlot ? data.newSlot.toString().trim() : "";
  const rowNumber = Number(data.row);

  if (!name || name.length > 100 || !/^\d{4}$/.test(password)) return "NOT_FOUND";
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || !isIsoDate(oldDate) || CONSULT_SLOTS.indexOf(oldSlot) === -1) return "NOT_FOUND";
  if (oldDate === newDate && oldSlot === newSlot) return "SAME_RESERVATION";
  if (!isIsoDate(newDate) || CONSULT_SLOTS.indexOf(newSlot) === -1) return "INVALID_DATE";

  const lock = LockService.getScriptLock();
  let result = "NOT_FOUND";
  let calendarEventId = "";
  lock.waitLock(10000);
  try {
    if (rowNumber > sheet.getLastRow()) return "NOT_FOUND";
    const row = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
    const currentDate = parseKoreanDate(row[0]);
    const currentSlot = row[1] ? row[1].toString().trim() : "";
    const currentName = row[2] ? row[2].toString().trim() : "";
    const currentPassword = row[3] ? row[3].toString().trim() : "";
    if (currentDate !== oldDate || currentSlot !== oldSlot || currentName !== name || currentPassword !== password) return "NOT_FOUND";
    if (sheetBoolean(row[4])) return "COMPLETED_RESERVATION";

    result = getReservationChangeValidationError(ss, newDate, newSlot);
    if (result) return result;

    const rows = sheet.getDataRange().getValues();
    const slotTaken = isReservationSlotTaken(sheet, newDate, newSlot, rowNumber);
    if (slotTaken) return "SLOT_TAKEN";

    if (hasWeeklyReservationConflict(rows, name, newDate, rowNumber)) return "DUPLICATE_WEEKLY";

    calendarEventId = row[CALENDAR_EVENT_ID_COLUMN - 1] ? row[CALENDAR_EVENT_ID_COLUMN - 1].toString().trim() : "";
    sheet.getRange(rowNumber, 1, 1, 2).setValues([[newDate, newSlot]]);
    result = "Success";
  } finally {
    lock.releaseLock();
  }

  if (result === "Success") {
    const canCreateCalendarEvent = !calendarEventId || deleteCalendarEventSafely(calendarEventId);
    if (canCreateCalendarEvent) {
      if (calendarEventId) {
        const calendarLock = LockService.getScriptLock();
        calendarLock.waitLock(10000);
        try {
          if (rowNumber <= sheet.getLastRow()) {
            const currentCalendarId = sheet.getRange(rowNumber, CALENDAR_EVENT_ID_COLUMN).getValue();
            if ((currentCalendarId || "").toString().trim() === calendarEventId) sheet.getRange(rowNumber, CALENDAR_EVENT_ID_COLUMN).clearContent();
          }
        } finally {
          calendarLock.releaseLock();
        }
      }
      createCalendarEventForReservationSafely(rowNumber, newDate, newSlot, name);
    } else {
      console.error("Google Calendar event deletion failed after reservation change; new event creation skipped.");
    }
    if (changedBy === "관리자") {
      recordTodayAdminReservationChangeReminder({
        name: name,
        oldDate: oldDate,
        oldSlot: oldSlot,
        newDate: newDate,
        newSlot: newSlot,
        rowNumber: rowNumber
      });
    }
    notifyDiscordReservationChangeSafely(name, oldDate, oldSlot, newDate, newSlot, changedBy);
  }
  return result;
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

  if (data.action === "findReservationForChange") {
    try {
      return findReservationForChange(data, sheet);
    } catch (error) {
      logServerError("Reservation change lookup failed", error);
      return jsonOutput({ ok: false, error: "SERVER_ERROR" });
    }
  }
  if (data.action === "changeReservation") {
    try {
      return textOutput(changeReservation(data, ss, sheet));
    } catch (error) {
      logServerError("Reservation change failed", error);
      return textOutput("SERVER_ERROR");
    }
  }

  const { action, date, slot, name, password } = data;
  const trimmedName = name ? name.trim() : "";
  const trimmedPwd = password ? password.toString().trim() : "";

  if (action === "save") {
    if (getOperationSettings().operating === false) return textOutput("SERVICE_PAUSED");
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
  if (data.action === "adminGetReservationChangeSlots") return adminGetReservationChangeSlots(data);
  if (data.action === "adminChangeReservation") return adminChangeReservation(data);
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
  if (data.action === "adminCheckOperationStatus") return adminCheckOperationStatus();
  if (data.action === "adminGetOperationSettings") return adminGetOperationSettings();
  if (data.action === "adminSaveOperationSettings") return adminSaveOperationSettings(data);
  if (data.action === "adminBulkSetAvailability") return adminBulkSetAvailability(data);
  if (data.action === "adminBackupCurrentData") return adminBackupCurrentData();
  if (data.action === "adminTestDiscord") return adminRunIntegrationTest(testDiscordNotification);
  if (data.action === "adminTestTodaySummary") return adminRunIntegrationTest(testTodayCounselingSummary);
  if (data.action === "adminTestTodayAdminChangeReminder") return adminRunIntegrationTest(testTodayAdminChangeReminder);
  if (data.action === "adminReinstallMorningSummaryTrigger") return adminReinstallMorningSummaryTrigger();
  if (data.action === "adminTestTomorrowSummary" || data.action === "adminTestSlotStart") {
    return jsonOutput({ ok: true, sent: false, skipped: true, message: "현재 알림 정책에서는 지원하지 않는 알림입니다." });
  }

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

function getAdminReservationChangeTarget(data, sheet) {
  const rowNumber = Number(data.row);
  const oldDate = data.oldDate ? data.oldDate.toString().trim() : "";
  const oldSlot = data.oldSlot ? data.oldSlot.toString().trim() : "";
  const name = data.name ? data.name.toString().trim() : "";
  if (!Number.isInteger(rowNumber) || rowNumber < 2 || !isIsoDate(oldDate) || CONSULT_SLOTS.indexOf(oldSlot) === -1 || !name) return { error: "INVALID_ROW" };
  if (rowNumber > sheet.getLastRow()) return { error: "STALE_DATA" };
  const row = sheet.getRange(rowNumber, 1, 1, CALENDAR_EVENT_ID_COLUMN).getValues()[0];
  const currentDate = parseKoreanDate(row[0]);
  const currentSlot = row[1] ? row[1].toString().trim() : "";
  const currentName = row[2] ? row[2].toString().trim() : "";
  if (currentDate !== oldDate || currentSlot !== oldSlot || currentName !== name) return { error: "STALE_DATA" };
  if (sheetBoolean(row[4])) return { error: "COMPLETED_RESERVATION" };
  return { rowNumber: rowNumber, row: row, name: currentName, oldDate: currentDate, oldSlot: currentSlot };
}

function adminGetReservationChangeSlots(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const target = getAdminReservationChangeTarget(data || {}, sheet);
  if (target.error) return jsonOutput({ ok: false, error: target.error });
  const date = data.newDate ? data.newDate.toString().trim() : "";
  if (!isIsoDate(date)) return jsonOutput({ ok: false, error: "INVALID_DATE" });

  const allowedSlots = getAllowedSlotsForDate(ss, date);
  const weeklyConflict = hasWeeklyReservationConflict(sheet.getDataRange().getValues(), target.name, date, target.rowNumber);
  const slots = allowedSlots.map(slot => {
    const validationError = getReservationChangeValidationError(ss, date, slot);
    const taken = !validationError && isReservationSlotTaken(sheet, date, slot, target.rowNumber);
    return { slot: slot, available: !validationError && !taken && !weeklyConflict, error: validationError || (taken ? "SLOT_TAKEN" : (weeklyConflict ? "DUPLICATE_WEEKLY" : "")) };
  });
  return jsonOutput({ ok: true, slots: slots });
}

function adminChangeReservation(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONSULT_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "SHEET_NOT_FOUND" });
  const target = getAdminReservationChangeTarget(data || {}, sheet);
  if (target.error) return jsonOutput({ ok: false, error: target.error });
  const password = target.row[3] ? target.row[3].toString().trim() : "";
  const result = changeReservation({
    row: target.rowNumber,
    name: target.name,
    password: password,
    oldDate: target.oldDate,
    oldSlot: target.oldSlot,
    newDate: data.newDate,
    newSlot: data.newSlot
  }, ss, sheet, "관리자");
  return result === "Success" ? jsonOutput({ ok: true }) : jsonOutput({ ok: false, error: result || "SERVER_ERROR" });
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

function adminBulkSetAvailability(data) {
  const startDate = (data.startDate || "").toString().trim();
  const endDate = (data.endDate || "").toString().trim();
  const weekdays = Array.isArray(data.weekdays) ? data.weekdays.map(Number).filter(value => Number.isInteger(value) && value >= 0 && value <= 6) : [];
  const input = validateAvailabilityInput({
    date: startDate,
    operationType: data.operationType,
    slots: data.slots,
    note: data.note
  });
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) return jsonOutput({ ok: false, error: "INVALID_DATE_RANGE" });
  if (!input.ok) return jsonOutput(input);
  if (weekdays.length === 0) return jsonOutput({ ok: false, error: "WEEKDAY_REQUIRED" });

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AVAILABILITY_SHEET_NAME);
  if (!sheet) return jsonOutput({ ok: false, error: "AVAILABILITY_SHEET_NOT_FOUND" });
  if (!hasExtendedAvailabilityHeaders(sheet)) return jsonOutput({ ok: false, error: "AVAILABILITY_COLUMNS_REQUIRED" });
  const overwrite = data.overwrite === true;
  const dates = getDatesStartToIn(startDate, endDate).filter(date => {
    const day = new Date(date + "T00:00:00+09:00").getDay();
    return weekdays.indexOf(day) !== -1;
  });
  if (dates.length > 370) return jsonOutput({ ok: false, error: "BULK_RANGE_TOO_LARGE" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = sheet.getDataRange().getValues();
    const existingRows = {};
    rows.slice(1).forEach((row, index) => {
      const date = parseKoreanDate(row[0]);
      if (date) existingRows[date] = index + 2;
    });
    const flags = input.slots.concat([false, false, false, false]).slice(0, 4);
    const newRows = [];
    let added = 0, updated = 0, skipped = 0;
    dates.forEach(date => {
      const values = [date, flags[0], flags[1], flags[2], input.operationType, flags[3], input.note];
      if (existingRows[date]) {
        if (!overwrite) {
          skipped++;
          return;
        }
        sheet.getRange(existingRows[date], 1, 1, 7).setValues([values]);
        updated++;
      } else {
        newRows.push(values);
        added++;
      }
    });
    if (newRows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 7).setValues(newRows);
    return jsonOutput({ ok: true, result: { matched: dates.length, added: added, updated: updated, skipped: skipped } });
  } finally {
    lock.releaseLock();
  }
}

function adminGetOperationSettings() {
  const settings = getOperationSettings();
  const resolvedSlotTimes = {};
  CONSULT_SLOTS.forEach(slot => {
    const config = getSlotTimeConfig(slot);
    resolvedSlotTimes[slot] = config ? { start: config.start, end: config.end } : { start: "", end: "" };
  });
  const today = localIsoDate(new Date());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const availabilitySettings = getAvailabilitySettings(ss);
  const calendarSheet = ss.getSheetByName(CALENDAR_SHEET_NAME);
  const calendarRows = calendarSheet ? calendarSheet.getDataRange().getValues().slice(1) : [];
  const academicStateForDate = date => {
    const state = { vacation: false, blocked: false };
    calendarRows.forEach(row => {
      const start = parseKoreanDate(row[0]);
      const end = row[1] ? parseKoreanDate(row[1]) : start;
      if (!start || !end || date < start || date > end) return;
      if (isAutoPublicHolidayTitle(row[2]) || isSchoolPolicyMemorialTitle(row[2])) return;
      if (isVacationTitle(row[2])) state.vacation = true;
      else state.blocked = true;
    });
    return state;
  };
  const operationForDate = date => {
    if (availabilitySettings[date]) return availabilitySettings[date];
    const period = getConfiguredPeriod(date, settings);
    if (period) return { operationType: period.operationType, slots: period.operationType === "semester" ? { "야자 1차시": true, "야자 2차시": true, "야자 3차시": true } : {} };
    const academic = academicStateForDate(date);
    return { operationType: academic.vacation ? "vacation" : "semester", slots: academic.vacation ? {} : { "야자 1차시": true, "야자 2차시": true, "야자 3차시": true }, blocked: academic.blocked };
  };
  const todayOperation = operationForDate(today);
  const todayDay = new Date(today + "T00:00:00+09:00").getDay();
  const todayHolidays = getKoreanHolidays(Number(today.substring(0, 4)));
  const todayAvailable = settings.operating !== false && todayDay !== 0 && todayDay !== 6 &&
    !todayHolidays[today] && !todayOperation.blocked &&
    Object.keys(todayOperation.slots || {}).some(slot => todayOperation.slots[slot] === true);
  let nextAvailableDate = "";
  const holidayCache = {};
  for (let offset = 0; offset <= 366; offset++) {
    const date = localIsoDate(addDays(new Date(today + "T00:00:00+09:00"), offset));
    const day = new Date(date + "T00:00:00+09:00").getDay();
    const year = date.substring(0, 4);
    if (!holidayCache[year]) holidayCache[year] = getKoreanHolidays(Number(year));
    const operation = operationForDate(date);
    if (day === 0 || day === 6 || holidayCache[year][date] || operation.blocked || settings.operating === false) continue;
    if (Object.keys(operation.slots || {}).some(slot => operation.slots[slot] === true)) {
      nextAvailableDate = date;
      break;
    }
  }
  const integration = JSON.parse(adminGetIntegrationStatus().getContent());
  return jsonOutput({
    ok: true,
    settings: Object.assign({}, settings, { slotTimes: resolvedSlotTimes }),
    dashboard: {
      today: today,
      operationType: todayOperation.operationType,
      todayAvailable: todayAvailable,
      nextAvailableDate: nextAvailableDate,
      discordConfigured: Boolean(integration.status && integration.status.discordConfigured),
      triggersInstalled: Boolean(integration.status && integration.status.triggersInstalled)
    }
  });
}

function adminSaveOperationSettings(data) {
  const validated = validateOperationSettings(data);
  if (!validated.ok) return jsonOutput(validated);
  getScriptProperties().setProperty(OPERATION_SETTINGS_KEY, JSON.stringify(validated.settings));
  return jsonOutput({ ok: true, settings: validated.settings });
}

function sanitizeBackupSheetName(value) {
  return (value || "").toString().replace(/[:\\\/?*\[\]]/g, "_").replace(/\s+/g, " ").trim();
}

function getUniqueBackupSheetName(ss, baseName, timestamp) {
  const safeBase = sanitizeBackupSheetName(baseName).substring(0, 100);
  if (!ss.getSheetByName(safeBase)) return safeBase;
  const suffix = "_" + timestamp;
  let candidate = safeBase.substring(0, 100 - suffix.length) + suffix;
  let sequence = 2;
  while (ss.getSheetByName(candidate)) {
    const numberedSuffix = suffix + "_" + sequence;
    candidate = safeBase.substring(0, 100 - numberedSuffix.length) + numberedSuffix;
    sequence++;
  }
  return candidate;
}

function adminBackupCurrentData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = getOperationSettings();
  const configuredYear = Number(settings.schoolYear);
  const schoolYear = Number.isInteger(configuredYear) && configuredYear >= 2000 && configuredYear <= 2200
    ? configuredYear
    : Number(Utilities.formatDate(new Date(), TIME_ZONE, "yyyy"));
  const timestamp = Utilities.formatDate(new Date(), TIME_ZONE, "yyyyMMdd_HHmm");
  const backedUpSheets = [];
  const skippedSheets = [];
  const sourceSheetNames = BACKUP_SOURCE_SHEET_NAMES.slice();
  ss.getSheets().forEach(sheet => {
    const sheetName = sheet.getName();
    const isRelatedSeparateSheet = /(상담\s*불가|학생\s*이력|상담\s*메모)/.test(sheetName);
    if (isRelatedSeparateSheet && sheetName.indexOf("_백업") === -1 && sourceSheetNames.indexOf(sheetName) === -1) {
      sourceSheetNames.push(sheetName);
    }
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sourceSheetNames.forEach(sourceName => {
      const sourceSheet = ss.getSheetByName(sourceName);
      if (!sourceSheet) {
        skippedSheets.push(sourceName + " 시트 없음");
        return;
      }
      const backupName = getUniqueBackupSheetName(ss, schoolYear + "_" + sourceName + "_백업", timestamp);
      try {
        sourceSheet.copyTo(ss).setName(backupName);
        backedUpSheets.push(backupName);
      } catch (error) {
        logServerError("Sheet backup failed [" + sourceName + "]", error);
        throw new Error("BACKUP_COPY_FAILED");
      }
    });
    if (backedUpSheets.length === 0) {
      return jsonOutput({ ok: false, error: "BACKUP_SOURCE_NOT_FOUND" });
    }
    return jsonOutput({ ok: true, backedUpSheets: backedUpSheets, skippedSheets: skippedSheets });
  } catch (error) {
    logServerError("Current data backup failed", error);
    return jsonOutput({ ok: false, error: "BACKUP_FAILED" });
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
    if (rawTitle && (isAutoPublicHolidayTitle(rawTitle) || isSchoolPolicyMemorialTitle(rawTitle))) continue;
    items.push({
      row: i + 1,
      startDate: startDate,
      endDate: endDate,
      title: rawTitle || BLOCKED_PERIOD_TITLE,
      kind: !rawTitle || rawTitle === BLOCKED_PERIOD_TITLE ? "blocked" : "academic",
      readonly: false
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
  const configuredTime = (getOperationSettings().slotTimes || {})[slot];
  const properties = getScriptProperties();
  const start = configuredTime && configuredTime.start
    ? configuredTime.start
    : properties.getProperty(propertyKeys.start) || (propertyKeys.defaults ? propertyKeys.defaults[0] : "");
  const end = configuredTime && configuredTime.end
    ? configuredTime.end
    : properties.getProperty(propertyKeys.end) || (propertyKeys.defaults ? propertyKeys.defaults[1] : "");
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
  console.log("차시 시작 알림은 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
  return false;
}

function checkCounselingSlotStartNotifications() {
  console.log("차시 시작 알림은 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
  return false;
}

function testSlotStartNotification() {
  console.log("차시 시작 테스트는 현재 Discord 알림 정책에 따라 생략합니다.");
  return false;
}

function sendCounselingSummary(date, kind, testMode) {
  if (kind !== "today") {
    console.log("내일 상담 안내는 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
    return false;
  }
  const reservations = getReservationsForDate(date).filter(item => !item.completed);
  const dateLabel = formatKoreanDateLabel(date);
  const prefix = testMode ? "[테스트] " : "";

  // 상담이 없는 날에는 Webhook을 호출하지 않는다.
  if (reservations.length === 0) {
    console.log("오늘 상담 예약 없음 - 알림 생략 (" + dateLabel + ")");
    return false;
  }

  const lines = reservations.map(item => {
    return "- " + item.slot + " · " + item.name;
  }).join("\n");

  return sendDiscordEmbed({
    title: prefix + "📅 오늘의 상담 일정",
    url: getAdminPageUrl(),
    color: 3447003,
    fields: [
      { name: "날짜", value: dateLabel, inline: true },
      { name: "전체 예약", value: reservations.length + "건", inline: true },
      { name: "일정", value: lines, inline: false },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function runDailySummary(kind) {
  if (kind !== "today") {
    console.log("내일 상담 안내는 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
    return false;
  }
  if (!isPropertyEnabled("DISCORD_DAILY_SUMMARY_ENABLED")) {
    console.log("당일 상담 아침 알림 생략: DISCORD_DAILY_SUMMARY_ENABLED가 true가 아닙니다.");
    return false;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    const date = localIsoDate(now);
    const key = kind + "|" + date;
    const state = cleanDatedState(readJsonProperty(SUMMARY_STATE_KEY), localIsoDate(addDays(now, -14)));
    if (state[key]) {
      console.log("당일 상담 아침 알림 생략: 이미 발송됨 (" + key + ")");
      return false;
    }
    if (!sendCounselingSummary(date, kind, false)) {
      console.log("당일 상담 아침 알림 생략: 오늘 미완료 예약이 없거나 Discord 전송에 실패했습니다. (" + date + ")");
      return false;
    }
    state[key] = discordTimestampLabel();
    writeJsonProperty(SUMMARY_STATE_KEY, state);
    console.log("당일 상담 아침 알림 발송 완료: " + date);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function runTodayCounselingSummary() {
  return runDailySummary("today");
}

function runTomorrowCounselingSummary() {
  console.log("내일 상담 안내는 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
  return false;
}

function testTodayCounselingSummary() {
  return sendCounselingSummary(localIsoDate(new Date()), "today", true);
}

function getTodayAdminChangeReminderTargets(state, date) {
  return Object.keys(state).map(key => state[key]).filter(item => item && item.oldDate === date && !item.sentAt);
}

function buildTodayAdminChangeReminderLines(targets) {
  const limited = targets.slice(0, 10);
  const lines = limited.map((item, index) => {
    return (index + 1) + ". " + item.name + "\n기존: " + item.oldDate + " · " + formatSlotWithTime(item.oldSlot) + "\n변경: " + item.newDate + " · " + formatSlotWithTime(item.newSlot);
  });
  if (targets.length > limited.length) lines.push("외 " + (targets.length - limited.length) + "건");
  return lines.join("\n\n").slice(0, 1000);
}

function sendTodayAdminChangeReminder(targets, testMode) {
  if (!targets.length) return false;
  return sendDiscordEmbed({
    title: testMode ? "🧪 [테스트] 학생 안내 확인" : "🔔 학생 안내 확인",
    url: getAdminPageUrl(),
    color: 16753920,
    description: "오늘 예정이었던 상담이 관리자에 의해 변경되었습니다.\n학생에게 변경 내용을 안내했는지 확인해 주세요.",
    fields: [
      { name: "오늘 안내가 필요한 예약 변경", value: targets.length + "건", inline: true },
      { name: "변경 내역", value: buildTodayAdminChangeReminderLines(targets), inline: false },
      { name: "관리자 페이지", value: "[바로가기](" + getAdminPageUrl() + ")", inline: false }
    ]
  });
}

function runTodayAdminChangeReminder() {
  if (!isAdminChangeReminderEnabled()) {
    console.log("당일 관리자 변경 리마인드 생략: " + ADMIN_CHANGE_REMINDER_ENABLED_KEY + "가 false입니다.");
    return false;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const now = new Date();
    const date = localIsoDate(now);
    const state = cleanDatedState(readJsonProperty(ADMIN_CHANGE_REMINDER_STATE_KEY), localIsoDate(addDays(now, -14)));
    const targets = getTodayAdminChangeReminderTargets(state, date);
    if (!targets.length) {
      console.log("당일 관리자 변경 리마인드 생략: 대상 없음 (" + date + ")");
      return false;
    }
    if (!sendTodayAdminChangeReminder(targets, false)) {
      console.error("당일 관리자 변경 리마인드 전송 실패: " + date);
      return false;
    }
    targets.forEach(item => { item.sentAt = discordTimestampLabel(); });
    writeJsonProperty(ADMIN_CHANGE_REMINDER_STATE_KEY, state);
    console.log("당일 관리자 변경 리마인드 발송 완료: " + date + " · " + targets.length + "건");
    return true;
  } finally {
    lock.releaseLock();
  }
}

function testTodayAdminChangeReminder() {
  const state = cleanDatedState(readJsonProperty(ADMIN_CHANGE_REMINDER_STATE_KEY), localIsoDate(addDays(new Date(), -14)));
  return sendTodayAdminChangeReminder(getTodayAdminChangeReminderTargets(state, localIsoDate(new Date())), true);
}

function testTomorrowCounselingSummary() {
  console.log("내일 상담 안내 테스트는 현재 Discord 알림 정책에 따라 발송하지 않습니다.");
  return false;
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
  ScriptApp.newTrigger(MORNING_SUMMARY_TRIGGER_HANDLER).timeBased().atHour(8).nearMinute(0).everyDays(1).inTimezone(TIME_ZONE).create();
  ScriptApp.newTrigger(ADMIN_CHANGE_REMINDER_TRIGGER_HANDLER).timeBased().atHour(16).nearMinute(0).everyDays(1).inTimezone(TIME_ZONE).create();
  return getCounselingTriggerStatus();
}

function getCounselingTriggerDiagnostics() {
  const handlers = {};
  COUNSELING_TRIGGER_HANDLERS.forEach(handler => { handlers[handler] = []; });
  const all = [];
  ScriptApp.getProjectTriggers().forEach(trigger => {
    const handler = trigger.getHandlerFunction();
    const descriptor = {
      handler: handler,
      eventType: String(trigger.getEventType()),
      triggerSource: String(trigger.getTriggerSource()),
      uniqueId: trigger.getUniqueId()
    };
    all.push(descriptor);
    if (Object.prototype.hasOwnProperty.call(handlers, handler)) handlers[handler].push(descriptor);
  });
  const morningTriggers = handlers[MORNING_SUMMARY_TRIGGER_HANDLER] || [];
  const adminChangeReminderTriggers = handlers[ADMIN_CHANGE_REMINDER_TRIGGER_HANDLER] || [];
  const legacyTriggers = all.filter(item => item.handler === "checkCounselingSlotStartNotifications" || item.handler === "runTomorrowCounselingSummary");
  return {
    projectTimeZone: Session.getScriptTimeZone(),
    expectedTimeZone: TIME_ZONE,
    morning: {
      handler: MORNING_SUMMARY_TRIGGER_HANDLER,
      installed: morningTriggers.length > 0,
      eventType: "CLOCK",
      schedule: MORNING_SUMMARY_TRIGGER_SCHEDULE_LABEL,
      triggers: morningTriggers
    },
    adminChangeReminder: {
      handler: ADMIN_CHANGE_REMINDER_TRIGGER_HANDLER,
      installed: adminChangeReminderTriggers.length > 0,
      eventType: "CLOCK",
      schedule: ADMIN_CHANGE_REMINDER_TRIGGER_SCHEDULE_LABEL,
      triggers: adminChangeReminderTriggers
    },
    legacyTriggers: legacyTriggers,
    handlers: handlers
  };
}

function getCounselingTriggerStatus() {
  const installed = {};
  COUNSELING_TRIGGER_HANDLERS.forEach(handler => { installed[handler] = false; });
  const diagnostics = getCounselingTriggerDiagnostics();
  Object.keys(installed).forEach(handler => { installed[handler] = (diagnostics.handlers[handler] || []).length > 0; });
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

function adminReinstallMorningSummaryTrigger() {
  try {
    const triggers = installCounselingTriggers();
    const diagnostics = getCounselingTriggerDiagnostics();
    return jsonOutput({
      ok: true,
      triggers: triggers,
      morningSummaryTrigger: diagnostics.morning,
      adminChangeReminderTrigger: diagnostics.adminChangeReminder
    });
  } catch (error) {
    logServerError("Morning summary trigger reinstall failed", error);
    return jsonOutput({ ok: false, error: "TRIGGER_INSTALL_FAILED" });
  }
}

function adminGetIntegrationStatus() {
  const properties = getScriptProperties();
  const slotConfigs = getAllSlotTimeConfigs();
  let triggers = {};
  let triggerStatusAvailable = true;
  let triggerDiagnostics = null;
  try {
    triggers = getCounselingTriggerStatus();
    triggerDiagnostics = getCounselingTriggerDiagnostics();
  } catch (error) {
    triggerStatusAvailable = false;
    COUNSELING_TRIGGER_HANDLERS.forEach(handler => { triggers[handler] = false; });
    logServerError("Counseling trigger status lookup failed", error);
  }
  return jsonOutput({
    ok: true,
    status: {
      discordConfigured: Boolean(properties.getProperty(DISCORD_WEBHOOK_URL_KEY)),
      dailySummaryEnabled: isPropertyEnabled("DISCORD_DAILY_SUMMARY_ENABLED"),
      calendarEnabled: isPropertyEnabled("GOOGLE_CALENDAR_ENABLED"),
      slotTimesValid: Object.keys(slotConfigs).length === CONSULT_SLOTS.length,
      triggersInstalled: triggerStatusAvailable && REQUIRED_COUNSELING_TRIGGER_HANDLERS.every(handler => triggers[handler] === true),
      triggerStatusAvailable: triggerStatusAvailable,
      morningSummaryTrigger: triggerDiagnostics ? triggerDiagnostics.morning : null,
      adminChangeReminderEnabled: isAdminChangeReminderEnabled(),
      adminChangeReminderTrigger: triggerDiagnostics ? triggerDiagnostics.adminChangeReminder : null,
      legacyNotificationTriggers: triggerDiagnostics ? triggerDiagnostics.legacyTriggers : [],
      projectTimeZone: triggerDiagnostics ? triggerDiagnostics.projectTimeZone : "",
      expectedTimeZone: TIME_ZONE
    }
  });
}

function getOperationCheckHeaderIssues(sheet, expectedHeaders) {
  if (!sheet) return expectedHeaders.map(item => item.label);
  const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), expectedHeaders.length)).getValues()[0]
    .map(value => (value || "").toString().trim());
  return expectedHeaders.filter((item, index) => {
    const allowed = Array.isArray(item.names) ? item.names : [item.names];
    return allowed.indexOf(headers[index]) === -1;
  }).map(item => item.label);
}

function addOperationCheckItem(items, level, label, detail) {
  items.push({ level: level, label: label, detail: detail });
}

function adminCheckOperationStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const items = [];
  const consultSheet = ss.getSheetByName(CONSULT_SHEET_NAME);
  const calendarSheet = ss.getSheetByName(CALENDAR_SHEET_NAME);
  const availabilitySheet = ss.getSheetByName(AVAILABILITY_SHEET_NAME);
  const sheetChecks = [
    {
      sheet: consultSheet,
      label: "예약 시트",
      headers: [
        { label: "날짜", names: "날짜" }, { label: "시간", names: ["시간", "차시"] },
        { label: "이름", names: "이름" }, { label: "비밀번호", names: "비밀번호" },
        { label: "상담완료", names: "상담완료" }, { label: "상담메모", names: ["상담메모", "상담 메모"] }
      ]
    },
    {
      sheet: calendarSheet,
      label: "학교 일정 시트",
      headers: [
        { label: "날짜 또는 시작일", names: ["날짜", "시작일"] },
        { label: "종료일", names: "종료일" }, { label: "일정명", names: "일정명" }
      ]
    },
    {
      sheet: availabilitySheet,
      label: "상담 가능 시간 시트",
      headers: [
        { label: "날짜", names: "날짜" }, { label: "야자 1차시", names: "야자 1차시" },
        { label: "야자 2차시", names: "야자 2차시" }, { label: "야자 3차시", names: "야자 3차시" },
        { label: "운영유형", names: "운영유형" }, { label: "4차시", names: "4차시" }, { label: "비고", names: "비고" }
      ]
    }
  ];

  sheetChecks.forEach(check => {
    if (!check.sheet) {
      addOperationCheckItem(items, "error", check.label, "시트를 찾을 수 없습니다.");
      return;
    }
    const missingHeaders = getOperationCheckHeaderIssues(check.sheet, check.headers);
    if (missingHeaders.length) addOperationCheckItem(items, "error", check.label, "헤더 누락: " + missingHeaders.join(", "));
    else addOperationCheckItem(items, "success", check.label, "필수 헤더를 확인했습니다.");
  });

  const settings = getOperationSettings();
  const today = localIsoDate(new Date());
  if (settings.operating === false) addOperationCheckItem(items, "warning", "상담 운영 상태", "현재 일시 중지 상태입니다.");
  else addOperationCheckItem(items, "success", "상담 운영 상태", "운영 중입니다.");

  const invalidPeriods = (settings.periods || []).filter(period => !period || !period.name || !isIsoDate(period.startDate) || !isIsoDate(period.endDate) || period.startDate > period.endDate || OPERATION_TYPES.indexOf(period.operationType) === -1);
  if (invalidPeriods.length) addOperationCheckItem(items, "error", "운영 기간", "형식이 올바르지 않은 기간이 " + invalidPeriods.length + "개 있습니다.");
  else addOperationCheckItem(items, "success", "운영 기간", "등록된 기간을 기준으로 자동 판단할 수 있습니다.");

  if (settings.schoolStartDate && isIsoDate(settings.schoolStartDate)) addOperationCheckItem(items, "success", "개학일", settings.schoolStartDate + "로 설정되어 있습니다.");
  else addOperationCheckItem(items, "warning", "개학일", "값이 비어 있거나 날짜 형식을 확인해야 합니다.");

  let currentOperationType = "semester";
  try {
    const currentOperation = getDateOperation(ss, today);
    currentOperationType = currentOperation.operationType;
    addOperationCheckItem(items, "success", "현재 운영모드", getOperationTypeLabel(currentOperation.operationType) + " 모드로 계산되었습니다.");
  } catch (error) {
    logServerError("Operation mode check failed", error);
    addOperationCheckItem(items, "warning", "현재 운영모드", "확인 필요: 설정 또는 시트 상태를 점검하세요.");
  }

  const requiredSlots = currentOperationType === "vacation" ? VACATION_SLOTS : SEMESTER_SLOTS;
  const invalidSlots = requiredSlots.filter(slot => !getSlotTimeConfig(slot));
  if (invalidSlots.length) addOperationCheckItem(items, "warning", "차시 시간표", "시간 확인 필요: " + invalidSlots.join(", "));
  else addOperationCheckItem(items, "success", "차시 시간표", requiredSlots.length + "개 차시 시간을 확인했습니다.");

  try {
    const operationStatus = JSON.parse(adminGetOperationSettings().getContent()).dashboard || {};
    if (operationStatus.nextAvailableDate) addOperationCheckItem(items, "success", "다음 상담 가능일", operationStatus.nextAvailableDate + "로 계산되었습니다.");
    else addOperationCheckItem(items, "warning", "다음 상담 가능일", "현재 신청 가능한 상담 시간이 없습니다.");
  } catch (error) {
    logServerError("Next available date check failed", error);
    addOperationCheckItem(items, "warning", "다음 상담 가능일", "확인 필요: 가능 시간 설정을 점검하세요.");
  }

  try {
    const integration = JSON.parse(adminGetIntegrationStatus().getContent()).status || {};
    addOperationCheckItem(items, integration.discordConfigured ? "success" : "warning", "Discord", integration.discordConfigured ? "Webhook이 설정되어 있습니다." : "Webhook이 설정되지 않았습니다.");
    const morningTrigger = integration.morningSummaryTrigger || {};
    const triggerLevel = integration.triggerStatusAvailable === false ? "warning" : morningTrigger.installed ? "success" : "warning";
    const triggerDetail = integration.triggerStatusAvailable === false
      ? "확인 필요: 트리거 권한 또는 상태를 확인하세요."
      : morningTrigger.installed
        ? "" + morningTrigger.handler + " · " + morningTrigger.schedule + " · " + (integration.projectTimeZone || TIME_ZONE)
        : morningTrigger.handler + " 트리거가 설치되어 있지 않습니다.";
    addOperationCheckItem(items, triggerLevel, "당일 상담 아침 알림 트리거", triggerDetail);
    const adminChangeReminderTrigger = integration.adminChangeReminderTrigger || {};
    const reminderLevel = integration.triggerStatusAvailable === false ? "warning"
      : !integration.adminChangeReminderEnabled ? "info"
      : adminChangeReminderTrigger.installed ? "success" : "warning";
    const reminderDetail = integration.triggerStatusAvailable === false
      ? "확인 필요: 트리거 권한 또는 상태를 확인하세요."
      : !integration.adminChangeReminderEnabled
        ? "사용 안 함 (" + ADMIN_CHANGE_REMINDER_ENABLED_KEY + "=false)"
        : adminChangeReminderTrigger.installed
          ? adminChangeReminderTrigger.handler + " · " + adminChangeReminderTrigger.schedule + " · " + (integration.projectTimeZone || TIME_ZONE)
          : adminChangeReminderTrigger.handler + " 트리거가 설치되어 있지 않습니다.";
    addOperationCheckItem(items, reminderLevel, "당일 관리자 변경 리마인드 트리거", reminderDetail);
    if (integration.legacyNotificationTriggers && integration.legacyNotificationTriggers.length) {
      addOperationCheckItem(items, "warning", "이전 알림 트리거", integration.legacyNotificationTriggers.map(item => item.handler).join(", ") + "가 남아 있습니다. installCounselingTriggers()를 실행해 정리하세요.");
    } else {
      addOperationCheckItem(items, "success", "내일 상담 안내 트리거", "사용하지 않음 (현재 알림 정책과 일치)");
    }
    if (integration.projectTimeZone && integration.projectTimeZone !== TIME_ZONE) {
      addOperationCheckItem(items, "warning", "프로젝트 시간대", integration.projectTimeZone + "로 설정되어 있습니다. " + TIME_ZONE + "인지 확인하세요.");
    } else {
      addOperationCheckItem(items, "success", "프로젝트 시간대", TIME_ZONE + "으로 확인했습니다.");
    }
    addOperationCheckItem(items, integration.calendarEnabled ? "success" : "warning", "Google Calendar", integration.calendarEnabled ? "연동이 활성화되어 있습니다." : "연동을 사용하지 않도록 설정되어 있습니다.");
  } catch (error) {
    logServerError("Integration operation check failed", error);
    addOperationCheckItem(items, "warning", "외부 연동", "확인 필요: 권한 또는 연동 설정을 확인하세요.");
  }

  const backupCount = ss.getSheets().filter(sheet => sheet.getName().indexOf("_백업") !== -1).length;
  addOperationCheckItem(items, "info", "백업 시트", backupCount ? backupCount + "개를 참고용으로 확인했습니다." : "등록된 백업 시트가 없습니다.");

  const summary = { success: 0, warning: 0, error: 0, info: 0 };
  items.forEach(item => { summary[item.level] = (summary[item.level] || 0) + 1; });
  return jsonOutput({ ok: true, items: items, summary: summary, checkedAt: Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd HH:mm") });
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
