const ADMIN_GAS_URL = "https://script.google.com/macros/s/AKfycbxb_Ed3RuWJ0Coh_JKBHaPWZxZvJUUY1JqC4XOYnAv6WWyX1oFs3EawJ-m6aEaew_FVvA/exec";
const ADMIN_SESSION_KEY = "counselingAdminSession";
const forceAdminLogin = new URLSearchParams(window.location.search).get('reauth') === '1';

if (forceAdminLogin) {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    history.replaceState(null, '', window.location.pathname + window.location.hash);
}

let adminToken = sessionStorage.getItem(ADMIN_SESSION_KEY) || "";
let reservations = [];
let calendarItems = [];
let availabilityItems = [];
let operationSettings = null;
let pendingDelete = null;
let confirmTrigger = null;
let adminSlotTimes = {
    '자습 1차시': '08:20~10:10', '자습 2차시': '10:20~12:10',
    '자습 3차시': '13:00~14:50', '자습 4차시': '15:10~17:00'
};
const ADMIN_SLOT_NAMES = { semester: ['야자 1차시', '야자 2차시', '야자 3차시'], vacation: ['자습 1차시', '자습 2차시', '자습 3차시', '자습 4차시'], closed: [] };

class AdminApiError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

function showMessage(elementId, message, success = false) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.classList.toggle('hidden', !message);
    element.classList.toggle('success', Boolean(message) && success);
}

function setButtonBusy(button, busy, busyText) {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? busyText : button.dataset.originalText;
}

function errorMessage(code) {
    const messages = {
        INVALID_CREDENTIALS: '관리자 비밀번호가 올바르지 않습니다.',
        AUTH_REQUIRED: '관리자 세션이 만료되었습니다. 다시 로그인해 주세요.',
        SHEET_NOT_FOUND: '필요한 Google Sheet를 찾지 못했습니다.',
        AVAILABILITY_SHEET_NOT_FOUND: '“상담가능시간” 시트를 찾지 못했습니다. README의 시트 설정을 확인해 주세요.',
        STALE_DATA: '시트 내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
        INVALID_ROW: '변경할 항목을 찾지 못했습니다.',
        INVALID_DATE: '날짜를 올바르게 입력해 주세요.',
        INVALID_DATE_RANGE: '종료일은 시작일보다 빠를 수 없습니다.',
        TITLE_REQUIRED: '학사일정 이름을 입력해 주세요.',
        PUBLIC_HOLIDAY_MANAGED_AUTOMATICALLY: '법정공휴일과 대체공휴일은 자동으로 달력에 표시됩니다. 학교 자체 일정만 등록해 주세요.',
        TITLE_TOO_LONG: '학사일정 이름은 100자 이하로 입력해 주세요.',
        NAME_REQUIRED: '학생 이름을 입력해 주세요.',
        INVALID_COMPLETED: '상담 완료 상태를 확인해 주세요.',
        MEMO_TOO_LONG: '상담 메모는 2,000자 이하로 입력해 주세요.',
        INVALID_AVAILABILITY: '상담 가능 시간 설정을 확인해 주세요.',
        AVAILABILITY_COLUMNS_REQUIRED: '상담가능시간 시트 E1~G1에 운영유형, 4차시, 비고 헤더를 추가해 주세요.',
        NOTE_TOO_LONG: '비고는 200자 이하로 입력해 주세요.',
        AVAILABILITY_EXISTS: '해당 날짜의 설정이 이미 있습니다. 기존 항목을 수정해 주세요.',
        INVALID_SETTINGS: '학급 및 운영 설정의 필수 값을 확인해 주세요.',
        SETTINGS_TOO_LONG: '운영 설정 문구가 허용 길이를 초과했습니다.',
        INVALID_PERIOD: '운영 기간의 이름과 날짜를 확인해 주세요.',
        INVALID_SLOT_TIME: '차시 시간을 HH:mm 형식으로 입력하고 종료 시간을 시작 시간보다 늦게 설정해 주세요.',
        WEEKDAY_REQUIRED: '일괄 적용할 요일을 하나 이상 선택해 주세요.',
        BULK_RANGE_TOO_LARGE: '일괄 적용 기간은 최대 370일입니다.',
        BACKUP_SOURCE_NOT_FOUND: '백업할 원본 시트를 찾지 못했습니다.',
        BACKUP_FAILED: '백업 중 오류가 발생했습니다. 원본 데이터는 변경되지 않았습니다.',
        WRONG_CURRENT_PASSWORD: '현재 관리자 비밀번호가 올바르지 않습니다.',
        ADMIN_PASSWORD_POLICY: '관리자 비밀번호는 4자 이상 64자 이하로 입력해 주세요.',
        INVALID_ACTION: '지원하지 않는 관리자 작업입니다.',
        INTEGRATION_TEST_FAILED: '연동 테스트를 실행하지 못했습니다. Apps Script 실행 로그를 확인해 주세요.',
        SERVER_ERROR: '서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        INVALID_RESPONSE: '서버 응답을 확인할 수 없습니다. Apps Script 배포 버전을 확인해 주세요.',
        NETWORK_ERROR: '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'
    };
    return messages[code] || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

async function adminRequest(action, payload = {}) {
    let response;
    try {
        response = await fetch(ADMIN_GAS_URL, {
            method: 'POST',
            body: JSON.stringify({ action, token: adminToken, ...payload })
        });
    } catch (error) {
        throw new AdminApiError('NETWORK_ERROR');
    }

    if (!response.ok) throw new AdminApiError('NETWORK_ERROR');

    const text = await response.text();
    let result;
    try {
        result = JSON.parse(text);
    } catch (error) {
        throw new AdminApiError('INVALID_RESPONSE');
    }

    if (!result.ok) {
        if (result.error === 'AUTH_REQUIRED') {
            clearAdminSession();
            showLoginView('관리자 세션이 만료되었습니다. 다시 로그인해 주세요.');
        }
        throw new AdminApiError(result.error || 'UNKNOWN_ERROR');
    }
    return result;
}

function clearAdminSession() {
    adminToken = '';
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

function showLoginView(message = '') {
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    document.getElementById('login-form').reset();
    showMessage('login-message', message);
    setTimeout(() => document.getElementById('admin-password').focus(), 0);
}

function showDashboardView() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');
    showMessage('login-message', '');
}

function createTextElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text;
    return element;
}

function createActionButton(label, styleClass, action, row) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-button ' + styleClass;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.row = String(row);
    return button;
}

function renderReservations() {
    const nameFilter = document.getElementById('reservation-name-filter').value.trim().toLowerCase();
    const dateFilter = document.getElementById('reservation-date-filter').value;
    const slotFilter = document.getElementById('reservation-slot-filter').value;
    const filtered = reservations.filter(item => {
        return (!nameFilter || item.name.toLowerCase().includes(nameFilter)) &&
            (!dateFilter || item.date === dateFilter) &&
            (!slotFilter || item.slot === slotFilter);
    });

    document.getElementById('reservation-count').textContent = `전체 ${reservations.length}건 · 표시 ${filtered.length}건`;
    const list = document.getElementById('reservation-list');
    list.replaceChildren();

    if (filtered.length === 0) {
        list.appendChild(createTextElement('p', 'empty-state', '조건에 맞는 상담 예약이 없습니다.'));
        return;
    }

    filtered.forEach(item => {
        const article = document.createElement('article');
        article.className = 'list-item reservation-item';
        article.dataset.row = String(item.row);

        const summary = document.createElement('div');
        summary.className = 'reservation-summary';
        summary.appendChild(createTextElement('div', 'item-title', item.name));
        summary.appendChild(createTextElement('div', 'item-meta', item.date));
        summary.appendChild(createTextElement('div', 'item-meta', item.slot));
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.appendChild(createActionButton('학생 이력', 'secondary', 'show-history', item.row));
        actions.appendChild(createActionButton('예약 삭제', 'danger', 'delete-reservation', item.row));
        summary.appendChild(actions);
        article.appendChild(summary);

        const editor = document.createElement('div');
        editor.className = 'reservation-editor';
        const completedLabel = document.createElement('label');
        completedLabel.className = 'completed-label';
        const completedInput = document.createElement('input');
        completedInput.type = 'checkbox';
        completedInput.dataset.field = 'completed';
        completedInput.checked = item.completed === true;
        completedLabel.append(completedInput, document.createTextNode(' 상담 완료'));
        editor.appendChild(completedLabel);

        const memoField = document.createElement('div');
        memoField.className = 'memo-field';
        const memoLabel = createTextElement('label', 'form-label', '상담 메모 (민감정보 입력 금지)');
        const memoInput = document.createElement('textarea');
        memoInput.className = 'form-input memo-input';
        memoInput.dataset.field = 'memo';
        memoInput.maxLength = 2000;
        memoInput.value = item.memo || '';
        memoLabel.appendChild(memoInput);
        memoField.appendChild(memoLabel);
        editor.appendChild(memoField);
        editor.appendChild(createActionButton('상태·메모 저장', 'primary', 'save-consultation', item.row));
        article.appendChild(editor);
        list.appendChild(article);
    });
}

function renderAvailability() {
    const list = document.getElementById('availability-list');
    list.replaceChildren();
    if (availabilityItems.length === 0) {
        list.appendChild(createTextElement('p', 'empty-state', '별도로 설정된 날짜가 없습니다. 방학 기간은 기본 상담 불가입니다.'));
        return;
    }

    availabilityItems.forEach(item => {
        const article = document.createElement('article');
        article.className = 'list-item availability-item';
        article.appendChild(createTextElement('div', 'item-title', item.date));
        const names = ADMIN_SLOT_NAMES[item.operationType] || ADMIN_SLOT_NAMES.semester;
        const enabled = item.slots.map((value, index) => value ? names[index] : '').filter(Boolean);
        const typeLabel = item.operationType === 'vacation' ? '방학' : item.operationType === 'closed' ? '상담 불가' : '학기 중';
        const details = document.createElement('div');
        const badges = document.createElement('div'); badges.className = 'item-badges';
        badges.appendChild(createTextElement('span', `item-badge type-${item.operationType || 'semester'}`, typeLabel));
        (enabled.length ? enabled : ['가능 시간 없음']).forEach(label => badges.appendChild(createTextElement('span', 'item-badge', label)));
        details.appendChild(badges);
        if (item.note) details.appendChild(createTextElement('p', 'item-note', item.note));
        article.appendChild(details);
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.appendChild(createActionButton('수정', 'secondary', 'edit-availability', item.row));
        actions.appendChild(createActionButton('삭제', 'danger', 'delete-availability', item.row));
        article.appendChild(actions);
        list.appendChild(article);
    });
}

function renderHistory(history, name) {
    const list = document.getElementById('history-list');
    list.replaceChildren();
    if (history.length === 0) {
        list.appendChild(createTextElement('p', 'empty-state', `${name} 학생의 상담 이력이 없습니다.`));
        return;
    }
    history.forEach(item => {
        const article = document.createElement('article');
        article.className = 'list-item history-item';
        article.dataset.row = String(item.row);
        article.dataset.date = item.date;
        article.dataset.slot = item.slot;
        article.dataset.name = item.name;
        article.dataset.completed = String(item.completed);
        
        const summary = document.createElement('div');
        summary.className = 'history-summary';
        const content = document.createElement('div');
        content.className = 'history-content';
        content.appendChild(createTextElement('div', 'history-date', item.date));

        const details = document.createElement('div');
        details.className = 'history-details';
        details.appendChild(createTextElement('span', 'history-slot-badge', item.slot));
        content.appendChild(details);

        const memo = document.createElement('div');
        memo.className = 'history-memo';
        memo.appendChild(createTextElement('span', 'history-memo-label', '상담 메모'));
        memo.appendChild(createTextElement('p', `history-memo-text memo-display${item.memo ? '' : ' is-empty'}`, item.memo || '메모 없음'));
        content.appendChild(memo);
        summary.appendChild(content);

        const actions = document.createElement('div');
        actions.className = 'history-actions';
        actions.appendChild(createTextElement('span', `history-status-badge ${item.completed ? 'is-complete' : 'is-pending'}`, item.completed ? '완료' : '미완료'));
        actions.appendChild(createActionButton('메모 수정', 'secondary', 'edit-history-memo', item.row));
        summary.appendChild(actions);
        article.appendChild(summary);

        const editor = document.createElement('div');
        editor.className = 'history-editor hidden';
        const memoField = document.createElement('div');
        memoField.className = 'memo-field history-memo-field';
        memoField.appendChild(createTextElement('span', 'history-memo-label', '상담 메모 수정'));
        const memoInput = document.createElement('textarea');
        memoInput.className = 'form-input memo-input history-memo-input';
        memoInput.maxLength = 2000;
        memoInput.value = item.memo || '';
        memoField.appendChild(memoInput);
        editor.appendChild(memoField);
        
        const editorActions = document.createElement('div');
        editorActions.className = 'history-editor-actions';
        editorActions.appendChild(createActionButton('저장', 'primary', 'save-history-memo', item.row));
        editorActions.appendChild(createActionButton('취소', 'secondary', 'cancel-history-memo', item.row));
        editor.appendChild(editorActions);

        article.appendChild(editor);
        list.appendChild(article);
    });
}

function renderCalendarList(kind) {
    const listId = kind === 'academic' ? 'academic-list' : 'blocked-list';
    const list = document.getElementById(listId);
    const filtered = calendarItems.filter(item => item.kind === kind);
    list.replaceChildren();

    if (filtered.length === 0) {
        list.appendChild(createTextElement('p', 'empty-state', kind === 'academic' ? '등록된 학사일정이 없습니다.' : '등록된 상담 불가 기간이 없습니다.'));
        return;
    }

    filtered.forEach(item => {
        const article = document.createElement('article');
        article.className = 'list-item calendar-item';
        article.appendChild(createTextElement('div', 'item-title', item.title));
        article.appendChild(createTextElement('div', 'item-meta', item.startDate === item.endDate ? item.startDate : `${item.startDate} ~ ${item.endDate}`));
        const actions = document.createElement('div');
        actions.className = 'item-actions';
        actions.appendChild(createActionButton('수정', 'secondary', 'edit-calendar', item.row));
        actions.appendChild(createActionButton('삭제', 'danger', 'delete-calendar', item.row));
        article.appendChild(actions);
        list.appendChild(article);
    });
}

function renderAllData() {
    renderReservations();
    renderCalendarList('academic');
    renderCalendarList('blocked');
    renderAvailability();
    document.getElementById('dashboard-summary').textContent =
        `예약 ${reservations.length}건 · 학사일정 ${calendarItems.filter(item => item.kind === 'academic').length}건 · 상담불가 ${calendarItems.filter(item => item.kind === 'blocked').length}건 · 가능 시간 설정 ${availabilityItems.length}건`;
}

function renderStats(stats) {
    const summary = stats.summary || {};
    const summaryItems = [
        ['오늘 상담', summary.today || 0, '건'], ['이번 주', summary.week || 0, '건'],
        ['이번 달', summary.month || 0, '건'], ['완료 상담', summary.completed || 0, '건'],
        ['미완료 상담', summary.incomplete || 0, '건'], ['상담 완료율', summary.completionRate || 0, '%']
    ];
    const summaryContainer = document.getElementById('stats-summary');
    summaryContainer.replaceChildren(...summaryItems.map(([label, value, unit]) => {
        const card = document.createElement('article');
        card.className = 'stat-card';
        card.append(createTextElement('span', 'stat-label', label), createTextElement('strong', 'stat-value', `${value}${unit}`));
        return card;
    }));

    const chartDefinitions = [
        ['학생별 상담 횟수', stats.byStudent], ['날짜별 상담 건수', stats.byDate],
        ['요일별 상담 건수', stats.byWeekday], ['시간대별 상담 건수', stats.bySlot],
        ['월별 상담 추이', stats.byMonth]
    ];
    const chartContainer = document.getElementById('stats-charts');
    chartContainer.replaceChildren(...chartDefinitions.map(([title, items]) => {
        const section = document.createElement('section');
        section.className = 'stat-chart';
        section.appendChild(createTextElement('h4', '', title));
        const values = Array.isArray(items) ? items : [];
        if (!values.length) {
            section.appendChild(createTextElement('p', 'empty-state compact', '표시할 데이터가 없습니다.'));
            return section;
        }
        const max = Math.max(...values.map(item => item.count), 1);
        values.forEach(item => {
            const row = document.createElement('div');
            row.className = 'stat-bar-row';
            row.appendChild(createTextElement('span', 'stat-bar-label', item.label));
            const track = document.createElement('div');
            track.className = 'stat-bar-track';
            const bar = document.createElement('span');
            bar.className = 'stat-bar-fill';
            bar.style.width = `${Math.max(4, item.count / max * 100)}%`;
            track.appendChild(bar);
            row.append(track, createTextElement('strong', 'stat-bar-count', String(item.count)));
            section.appendChild(row);
        });
        return section;
    }));
}

async function loadStats() {
    const completedValue = document.getElementById('stats-completed').value;
    const payload = {
        startDate: document.getElementById('stats-start-date').value,
        endDate: document.getElementById('stats-end-date').value,
        name: document.getElementById('stats-name').value.trim()
    };
    if (completedValue) payload.completed = completedValue === 'true';
    const result = await adminRequest('adminGetCounselingStats', payload);
    renderStats(result.stats || {});
}

function renderIntegrationStatus(status) {
    const labels = [
        ['Discord Webhook', status.discordConfigured],
        ['야자 차시 시작 알림', status.slotStartEnabled],
        ['오늘·내일 일정 요약', status.dailySummaryEnabled],
        ['Google Calendar 연동', status.calendarEnabled],
        ['상담 시간대 설정', status.slotTimesValid],
        ['Apps Script 트리거', status.triggersInstalled]
    ];
    const container = document.getElementById('integration-status');
    container.replaceChildren(...labels.map(([label, enabled]) => {
        const item = document.createElement('div');
        item.className = 'integration-status-item';
        item.append(createTextElement('span', '', label), createTextElement('strong', enabled ? 'status-complete' : 'status-pending', enabled ? '설정됨' : '미설정'));
        return item;
    }));
}

function operationTypeLabel(value) {
    return value === 'vacation' ? '방학' : value === 'closed' ? '상담 불가' : '학기 중';
}

function renderOperationStatus(dashboard = {}) {
    const settings = operationSettings || {};
    const vacationPeriods = (settings.periods || []).filter(item => item.operationType === 'vacation');
    const items = [
        ['학년도', settings.schoolYear ? `${settings.schoolYear}학년도` : '-'],
        ['학급', settings.className || '-'],
        ['현재 운영모드', operationTypeLabel(dashboard.operationType)],
        ['방학 기간', vacationPeriods.length ? vacationPeriods.map(item => `${item.name} ${item.startDate}~${item.endDate}`).join(' · ') : '설정 없음'],
        ['오늘 상담', dashboard.todayAvailable ? '가능' : '불가'],
        ['다음 상담 가능일', dashboard.nextAvailableDate || '예정 없음'],
        ['Discord', dashboard.discordConfigured ? '설정됨' : '미설정'],
        ['트리거', dashboard.triggersInstalled ? '설치됨' : '미설치']
    ];
    document.getElementById('operation-status-grid').replaceChildren(...items.map(([label, value]) => {
        const card = document.createElement('article');
        card.className = 'operation-status-card';
        card.append(createTextElement('span', 'stat-label', label), createTextElement('strong', 'operation-status-value', value));
        return card;
    }));
}

function createPeriodRow(period = {}) {
    const row = document.createElement('div');
    row.className = 'operation-period-row';
    row.dataset.periodId = period.id || '';
    const fields = [
        ['text', '기간 이름', period.name || '', 'period-name'],
        ['date', '시작일', period.startDate || '', 'period-start'],
        ['date', '종료일', period.endDate || '', 'period-end']
    ];
    fields.forEach(([type, labelText, value, className]) => {
        const label = createTextElement('label', 'form-label', labelText);
        const input = document.createElement('input');
        input.type = type; input.className = `form-input ${className}`; input.value = value; input.required = true;
        label.appendChild(input); row.appendChild(label);
    });
    const typeLabel = createTextElement('label', 'form-label', '운영 유형');
    const select = document.createElement('select'); select.className = 'form-input period-operation';
    [['semester', '학기 중'], ['vacation', '방학'], ['closed', '상담 불가']].forEach(([value, text]) => {
        const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = period.operationType === value;
        select.appendChild(option);
    });
    typeLabel.appendChild(select); row.appendChild(typeLabel);
    const remove = createTextElement('button', 'admin-button danger remove-period', '삭제');
    remove.type = 'button'; remove.setAttribute('aria-label', `${period.name || '운영 기간'} 삭제`);
    row.appendChild(remove);
    return row;
}

function renderOperationSettings(settings, dashboard) {
    operationSettings = settings;
    document.getElementById('setting-school-year').value = settings.schoolYear || '';
    document.getElementById('setting-class-name').value = settings.className || '';
    document.getElementById('setting-student-title').value = settings.studentTitle || '';
    document.getElementById('setting-admin-title').value = settings.adminTitle || '';
    document.getElementById('setting-operating').value = String(settings.operating !== false);
    document.getElementById('setting-school-start').value = settings.schoolStartDate || '';
    document.getElementById('setting-student-notice').value = settings.studentNotice || '';
    document.getElementById('setting-vacation-notice').value = settings.vacationNotice || '';
    document.getElementById('setting-password-notice').value = settings.passwordNotice || '';
    const periodList = document.getElementById('operation-period-list');
    periodList.replaceChildren(...(settings.periods || []).map(createPeriodRow));
    const slotContainer = document.getElementById('slot-time-settings');
    slotContainer.replaceChildren(...Object.values(ADMIN_SLOT_NAMES).flat().map(slot => {
        const value = (settings.slotTimes || {})[slot] || {};
        const row = document.createElement('div'); row.className = 'slot-time-row'; row.dataset.slot = slot;
        row.appendChild(createTextElement('strong', '', slot));
        [['시작', 'slot-start', value.start || ''], ['종료', 'slot-end', value.end || '']].forEach(([labelText, className, time]) => {
            const label = createTextElement('label', 'form-label', labelText);
            const input = document.createElement('input'); input.type = 'time'; input.className = `form-input ${className}`; input.value = time;
            label.appendChild(input); row.appendChild(label);
        });
        return row;
    }));
    const schoolYear = settings.schoolYear || 2026;
    const className = settings.className || '1학년 1반';
    document.title = `교사용 학생 상담 관리 | ${schoolYear}학년도 · ${className}`;
    document.getElementById('admin-service-title').textContent = '교사용 학생 상담 관리';
    document.getElementById('admin-service-eyebrow').textContent = `${schoolYear}학년도 · ${className}`;
    renderOperationStatus(dashboard);
}

async function loadIntegrationStatus() {
    const result = await adminRequest('adminGetIntegrationStatus');
    renderIntegrationStatus(result.status || {});
}

async function loadAdminData(showSuccess = false) {
    const refreshButton = document.getElementById('refresh-button');
    setButtonBusy(refreshButton, true, '불러오는 중…');
    showMessage('global-message', '');
    try {
        const [reservationResult, calendarResult, availabilityResult, statsResult, integrationResult, operationResult] = await Promise.all([
            adminRequest('adminListReservations'),
            adminRequest('adminListCalendarItems'),
            adminRequest('adminListAvailability'),
            adminRequest('adminGetCounselingStats'),
            adminRequest('adminGetIntegrationStatus'),
            adminRequest('adminGetOperationSettings')
        ]);
        reservations = reservationResult.reservations || [];
        calendarItems = calendarResult.items || [];
        availabilityItems = availabilityResult.items || [];
        adminSlotTimes = { ...adminSlotTimes, ...(availabilityResult.slotTimes || {}) };
        if (!document.getElementById('availability-row').value) {
            renderAvailabilitySlotChecks(document.getElementById('availability-operation').value || 'semester');
        }
        renderAllData();
        renderStats(statsResult.stats || {});
        renderIntegrationStatus(integrationResult.status || {});
        renderOperationSettings(operationResult.settings || {}, operationResult.dashboard || {});
        if (showSuccess) showMessage('global-message', 'Google Sheets의 최신 데이터를 불러왔습니다.', true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('global-message', errorMessage(error.code));
    } finally {
        setButtonBusy(refreshButton, false, '');
    }
}

function showTab(tabName) {
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
        const active = button.dataset.adminTab === tabName;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-admin-panel]').forEach(panel => {
        panel.classList.toggle('hidden', panel.dataset.adminPanel !== tabName);
    });
}

function resetCalendarForm(kind) {
    const form = document.getElementById(kind + '-form');
    form.reset();
    delete form.dataset.expectedStartDate;
    delete form.dataset.expectedEndDate;
    delete form.dataset.expectedTitle;
    document.getElementById(kind + '-row').value = '';
    document.getElementById(kind + '-submit').textContent = kind === 'academic' ? '일정 추가' : '기간 추가';
    document.getElementById(kind + '-cancel-edit').classList.add('hidden');
    showMessage(kind + '-message', '');
}

function startCalendarEdit(item) {
    const kind = item.kind;
    showTab(kind);
    const form = document.getElementById(kind + '-form');
    document.getElementById(kind + '-row').value = item.row;
    document.getElementById(kind + '-start').value = item.startDate;
    document.getElementById(kind + '-end').value = item.endDate;
    if (kind === 'academic') document.getElementById('academic-title').value = item.title;
    form.dataset.expectedStartDate = item.startDate;
    form.dataset.expectedEndDate = item.endDate;
    form.dataset.expectedTitle = item.title;
    document.getElementById(kind + '-submit').textContent = kind === 'academic' ? '일정 수정' : '기간 수정';
    document.getElementById(kind + '-cancel-edit').classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openConfirm(message, deleteInfo, trigger) {
    pendingDelete = deleteInfo;
    confirmTrigger = trigger;
    document.getElementById('confirm-message').textContent = message;
    const backdrop = document.getElementById('confirm-backdrop');
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.getElementById('confirm-delete').focus();
}

function closeConfirm() {
    const backdrop = document.getElementById('confirm-backdrop');
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    pendingDelete = null;
    if (confirmTrigger && document.contains(confirmTrigger)) confirmTrigger.focus();
    confirmTrigger = null;
}

document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('admin-password').value;
    const button = document.getElementById('login-submit');
    if (!password) {
        showMessage('login-message', '관리자 비밀번호를 입력해 주세요.');
        return;
    }

    setButtonBusy(button, true, '로그인 중…');
    showMessage('login-message', '');
    try {
        const result = await adminRequest('adminLogin', { password });
        adminToken = result.token;
        sessionStorage.setItem(ADMIN_SESSION_KEY, adminToken);
        showDashboardView();
        await loadAdminData();
    } catch (error) {
        showMessage('login-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.getElementById('logout-button').addEventListener('click', async () => {
    try { await adminRequest('adminLogout'); } catch (error) { /* 세션은 로컬에서 항상 종료 */ }
    clearAdminSession();
    reservations = [];
    calendarItems = [];
    availabilityItems = [];
    showLoginView('로그아웃되었습니다.');
});

document.getElementById('refresh-button').addEventListener('click', () => loadAdminData(true));
document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => showTab(button.dataset.adminTab)));
document.getElementById('reservation-name-filter').addEventListener('input', renderReservations);
document.getElementById('reservation-date-filter').addEventListener('change', renderReservations);
document.getElementById('reservation-slot-filter').addEventListener('change', renderReservations);

document.getElementById('stats-filter-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('stats-submit');
    setButtonBusy(button, true, '조회 중…');
    showMessage('stats-message', '');
    try {
        await loadStats();
        showMessage('stats-message', '통계를 조회했습니다.', true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('stats-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.getElementById('stats-reset').addEventListener('click', async () => {
    document.getElementById('stats-filter-form').reset();
    showMessage('stats-message', '');
    try { await loadStats(); } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('stats-message', errorMessage(error.code));
    }
});

document.getElementById('integration-refresh').addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '확인 중…');
    showMessage('integration-message', '');
    try {
        await loadIntegrationStatus();
        showMessage('integration-message', '설정 상태를 새로 확인했습니다.', true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('integration-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.querySelectorAll('.integration-test').forEach(button => button.addEventListener('click', async event => {
    const target = event.currentTarget;
    setButtonBusy(target, true, '전송 중…');
    showMessage('integration-message', '');
    try {
        const result = await adminRequest(target.dataset.testAction);
        showMessage('integration-message', result.sent ? '테스트 알림을 전송했습니다.' : '알림을 보내지 못했습니다. Script Properties와 실행 로그를 확인해 주세요.', result.sent);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('integration-message', errorMessage(error.code));
    } finally {
        setButtonBusy(target, false, '');
    }
}));

document.getElementById('reservation-list').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = reservations.find(reservation => reservation.row === Number(button.dataset.row));
    if (!item) return;

    if (button.dataset.action === 'delete-reservation') {
        openConfirm(`${item.date} ${item.slot} ${item.name} 학생의 예약을 삭제할까요?`, { type: 'reservation', item }, button);
        return;
    }
    if (button.dataset.action === 'show-history') {
        document.getElementById('history-name').value = item.name;
        showTab('history');
        await loadStudentHistory(item.name);
        return;
    }
    if (button.dataset.action === 'save-consultation') {
        const article = button.closest('.reservation-item');
        const completed = article.querySelector('[data-field="completed"]').checked;
        const memo = article.querySelector('[data-field="memo"]').value;
        setButtonBusy(button, true, '저장 중…');
        try {
            await adminRequest('adminUpdateConsultation', {
                row: item.row,
                date: item.date,
                slot: item.slot,
                name: item.name,
                completed,
                memo
            });
            await loadAdminData();
            showMessage('global-message', '상담 완료 상태와 메모를 저장했습니다.', true);
        } catch (error) {
            if (error.code !== 'AUTH_REQUIRED') showMessage('global-message', errorMessage(error.code));
        } finally {
            setButtonBusy(button, false, '');
        }
    }
});

async function loadStudentHistory(name) {
    const button = document.getElementById('history-submit');
    setButtonBusy(button, true, '조회 중…');
    showMessage('history-message', '');
    try {
        const result = await adminRequest('adminListStudentHistory', { name });
        renderHistory(result.history || [], result.name || name);
        showMessage('history-message', `${result.name || name} 학생의 상담 이력을 조회했습니다.`, true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('history-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
}

document.getElementById('history-list').addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const article = button.closest('.history-item');
    if (!article) return;
    
    if (button.dataset.action === 'edit-history-memo') {
        article.querySelector('.history-summary').classList.add('hidden');
        article.querySelector('.history-editor').classList.remove('hidden');
    } else if (button.dataset.action === 'cancel-history-memo') {
        article.querySelector('.history-editor').classList.add('hidden');
        article.querySelector('.history-summary').classList.remove('hidden');
    } else if (button.dataset.action === 'save-history-memo') {
        const row = Number(article.dataset.row);
        const date = article.dataset.date;
        const slot = article.dataset.slot;
        const name = article.dataset.name;
        const completed = article.dataset.completed === 'true';
        const memo = article.querySelector('.history-memo-input').value;

        setButtonBusy(button, true, '저장 중…');
        showMessage('history-message', '');
        try {
            await adminRequest('adminUpdateConsultation', { row, date, slot, name, completed, memo });
            showMessage('history-message', '메모를 수정했습니다.', true);
            await loadStudentHistory(name);
        } catch (error) {
            if (error.code !== 'AUTH_REQUIRED') showMessage('history-message', errorMessage(error.code));
        } finally {
            setButtonBusy(button, false, '');
        }
    }
});

document.getElementById('history-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = document.getElementById('history-name').value.trim();
    if (!name) {
        showMessage('history-message', '학생 이름을 입력해 주세요.');
        return;
    }
    loadStudentHistory(name);
});

function renderAvailabilitySlotChecks(operationType, values = []) {
    const fieldset = document.getElementById('availability-slot-checks');
    fieldset.querySelectorAll('label').forEach(label => label.remove());
    const names = ADMIN_SLOT_NAMES[operationType] || [];
    names.forEach((name, index) => {
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox'; input.id = `availability-slot-${index + 1}`; input.checked = values[index] !== false;
        label.append(input, document.createTextNode(` ${name}${adminSlotTimes[name] ? ` (${adminSlotTimes[name]})` : ''}`));
        fieldset.appendChild(label);
    });
    fieldset.disabled = operationType === 'closed';
}

function resetAvailabilityForm() {
    const form = document.getElementById('availability-form');
    form.reset();
    document.getElementById('availability-row').value = '';
    document.getElementById('availability-operation').value = 'semester';
    document.getElementById('availability-note').value = '';
    renderAvailabilitySlotChecks('semester');
    delete form.dataset.expectedDate;
    document.getElementById('availability-submit').textContent = '설정 추가';
    document.getElementById('availability-cancel-edit').classList.add('hidden');
    showMessage('availability-message', '');
}

function startAvailabilityEdit(item) {
    showTab('availability');
    const form = document.getElementById('availability-form');
    document.getElementById('availability-row').value = item.row;
    document.getElementById('availability-date').value = item.date;
    document.getElementById('availability-operation').value = item.operationType || 'semester';
    document.getElementById('availability-note').value = item.note || '';
    renderAvailabilitySlotChecks(item.operationType || 'semester', item.slots);
    form.dataset.expectedDate = item.date;
    document.getElementById('availability-submit').textContent = '설정 수정';
    document.getElementById('availability-cancel-edit').classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('availability-cancel-edit').addEventListener('click', resetAvailabilityForm);
document.getElementById('availability-operation').addEventListener('change', event => renderAvailabilitySlotChecks(event.target.value));
renderAvailabilitySlotChecks('semester');
document.getElementById('availability-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = availabilityItems.find(entry => entry.row === Number(button.dataset.row));
    if (!item) return;
    if (button.dataset.action === 'edit-availability') startAvailabilityEdit(item);
    if (button.dataset.action === 'delete-availability') {
        openConfirm(`${item.date}의 상담 가능 시간 설정을 삭제할까요? 방학 기간이면 기본 상담 불가, 학기 중이면 기본 시간이 적용됩니다.`, { type: 'availability', item }, button);
    }
});

document.getElementById('availability-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const row = document.getElementById('availability-row').value;
    const date = document.getElementById('availability-date').value;
    const operationType = document.getElementById('availability-operation').value;
    const slots = (ADMIN_SLOT_NAMES[operationType] || []).map((slot, index) => document.getElementById(`availability-slot-${index + 1}`).checked);
    const note = document.getElementById('availability-note').value.trim();
    const button = document.getElementById('availability-submit');
    if (!date) {
        showMessage('availability-message', '날짜를 입력해 주세요.');
        return;
    }

    const payload = { date, operationType, slots, note };
    if (row) {
        payload.row = Number(row);
        payload.expectedDate = form.dataset.expectedDate;
    }
    setButtonBusy(button, true, row ? '수정 중…' : '추가 중…');
    showMessage('availability-message', '');
    try {
        await adminRequest('adminSetAvailability', payload);
        resetAvailabilityForm();
        await loadAdminData();
        showMessage('availability-message', row ? '가능 시간 설정을 수정했습니다.' : '가능 시간 설정을 추가했습니다.', true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('availability-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

function renderBulkSlotChecks(operationType) {
    const fieldset = document.getElementById('bulk-slot-checks');
    fieldset.querySelectorAll('label').forEach(label => label.remove());
    (ADMIN_SLOT_NAMES[operationType] || []).forEach((name, index) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox'; input.id = `bulk-slot-${index + 1}`; input.checked = true;
        label.append(input, document.createTextNode(` ${name}${adminSlotTimes[name] ? ` (${adminSlotTimes[name]})` : ''}`));
        fieldset.appendChild(label);
    });
    fieldset.disabled = operationType === 'closed';
}

const bulkWeekdays = document.getElementById('bulk-weekdays');
['일', '월', '화', '수', '목', '금', '토'].forEach((labelText, day) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = String(day); input.checked = day >= 1 && day <= 5;
    label.append(input, document.createTextNode(` ${labelText}`));
    bulkWeekdays.appendChild(label);
});
document.getElementById('bulk-operation').addEventListener('change', event => renderBulkSlotChecks(event.target.value));
renderBulkSlotChecks('semester');

document.getElementById('bulk-availability-form').addEventListener('submit', async event => {
    event.preventDefault();
    const operationType = document.getElementById('bulk-operation').value;
    const startDate = document.getElementById('bulk-start-date').value;
    const endDate = document.getElementById('bulk-end-date').value;
    const weekdays = Array.from(document.querySelectorAll('#bulk-weekdays input:checked')).map(input => Number(input.value));
    const slots = (ADMIN_SLOT_NAMES[operationType] || []).map((slot, index) => document.getElementById(`bulk-slot-${index + 1}`).checked);
    const overwrite = document.getElementById('bulk-existing-policy').value === 'overwrite';
    const note = document.getElementById('bulk-note').value.trim();
    if (!startDate || !endDate || weekdays.length === 0) {
        showMessage('bulk-availability-message', '기간과 적용 요일을 입력해 주세요.');
        return;
    }
    const policyText = overwrite ? '기존 설정을 덮어씁니다.' : '기존 설정은 건너뜁니다.';
    if (!window.confirm(`${startDate}~${endDate} 기간에 ${operationTypeLabel(operationType)} 설정을 일괄 적용할까요?\n${policyText}`)) return;
    const button = document.getElementById('bulk-availability-submit');
    setButtonBusy(button, true, '적용 중…');
    showMessage('bulk-availability-message', '');
    try {
        const response = await adminRequest('adminBulkSetAvailability', { startDate, endDate, weekdays, operationType, slots, note, overwrite });
        const result = response.result || {};
        await loadAdminData();
        showMessage('bulk-availability-message', `일괄 적용 완료: 추가 ${result.added || 0}건, 변경 ${result.updated || 0}건, 건너뜀 ${result.skipped || 0}건`, true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('bulk-availability-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.getElementById('add-operation-period').addEventListener('click', () => {
    document.getElementById('operation-period-list').appendChild(createPeriodRow({ operationType: 'vacation' }));
});
document.getElementById('operation-period-list').addEventListener('click', event => {
    const button = event.target.closest('.remove-period');
    if (button) button.closest('.operation-period-row').remove();
});

document.getElementById('operation-settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const periods = Array.from(document.querySelectorAll('.operation-period-row')).map(row => ({
        id: row.dataset.periodId,
        name: row.querySelector('.period-name').value.trim(),
        startDate: row.querySelector('.period-start').value,
        endDate: row.querySelector('.period-end').value,
        operationType: row.querySelector('.period-operation').value
    }));
    const slotTimes = {};
    document.querySelectorAll('.slot-time-row').forEach(row => {
        slotTimes[row.dataset.slot] = {
            start: row.querySelector('.slot-start').value,
            end: row.querySelector('.slot-end').value
        };
    });
    const settings = {
        schoolYear: Number(document.getElementById('setting-school-year').value),
        className: document.getElementById('setting-class-name').value.trim(),
        studentTitle: document.getElementById('setting-student-title').value.trim(),
        adminTitle: document.getElementById('setting-admin-title').value.trim(),
        operating: document.getElementById('setting-operating').value === 'true',
        schoolStartDate: document.getElementById('setting-school-start').value,
        studentNotice: document.getElementById('setting-student-notice').value.trim(),
        vacationNotice: document.getElementById('setting-vacation-notice').value.trim(),
        passwordNotice: document.getElementById('setting-password-notice').value.trim(),
        periods,
        slotTimes
    };
    const button = document.getElementById('operation-settings-submit');
    setButtonBusy(button, true, '저장 중…');
    showMessage('operation-settings-message', '');
    try {
        await adminRequest('adminSaveOperationSettings', { settings });
        await loadAdminData();
        showMessage('operation-settings-message', '운영 설정을 저장했습니다. 학생 화면에는 새로고침 후 반영됩니다.', true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('operation-settings-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.getElementById('backup-current-data').addEventListener('click', async event => {
    if (!window.confirm('현재 데이터를 백업 시트로 복사합니다. 원본 데이터는 삭제되지 않습니다. 계속할까요?')) return;
    const button = event.currentTarget;
    setButtonBusy(button, true, '백업 중…');
    showMessage('backup-message', '');
    try {
        const result = await adminRequest('adminBackupCurrentData');
        const backedUpSheets = result.backedUpSheets || [];
        const skippedSheets = result.skippedSheets || [];
        let message = `백업이 완료되었습니다. 생성된 시트: ${backedUpSheets.join(', ')}`;
        if (skippedSheets.length > 0) message += ` · 건너뜀: ${skippedSheets.join(', ')}`;
        showMessage('backup-message', message, true);
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('backup-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

['academic', 'blocked'].forEach(kind => {
    document.getElementById(kind + '-cancel-edit').addEventListener('click', () => resetCalendarForm(kind));
    document.getElementById(kind + '-list').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const item = calendarItems.find(calendarItem => calendarItem.row === Number(button.dataset.row));
        if (!item) return;
        if (button.dataset.action === 'edit-calendar') startCalendarEdit(item);
        if (button.dataset.action === 'delete-calendar') {
            openConfirm(`${item.title} (${item.startDate} ~ ${item.endDate}) 항목을 삭제할까요?`, { type: 'calendar', item }, button);
        }
    });

    document.getElementById(kind + '-form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const row = document.getElementById(kind + '-row').value;
        const startDate = document.getElementById(kind + '-start').value;
        const endDate = document.getElementById(kind + '-end').value;
        const title = kind === 'academic' ? document.getElementById('academic-title').value.trim() : '상담불가';
        const button = document.getElementById(kind + '-submit');

        if (!startDate || !endDate || (kind === 'academic' && !title)) {
            showMessage(kind + '-message', '필수 항목을 모두 입력해 주세요.');
            return;
        }

        const payload = { kind, startDate, endDate, title };
        const action = row ? 'adminUpdateCalendarItem' : 'adminCreateCalendarItem';
        if (row) {
            payload.row = Number(row);
            payload.expectedStartDate = form.dataset.expectedStartDate;
            payload.expectedEndDate = form.dataset.expectedEndDate;
            payload.expectedTitle = form.dataset.expectedTitle;
        }

        setButtonBusy(button, true, row ? '수정 중…' : '추가 중…');
        showMessage(kind + '-message', '');
        try {
            await adminRequest(action, payload);
            resetCalendarForm(kind);
            await loadAdminData();
            showMessage(kind + '-message', row ? '항목을 수정했습니다.' : '항목을 추가했습니다.', true);
        } catch (error) {
            if (error.code !== 'AUTH_REQUIRED') showMessage(kind + '-message', errorMessage(error.code));
        } finally {
            setButtonBusy(button, false, '');
        }
    });
});

document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
document.getElementById('confirm-backdrop').addEventListener('click', event => {
    if (event.target.id === 'confirm-backdrop') closeConfirm();
});

document.getElementById('confirm-delete').addEventListener('click', async event => {
    if (!pendingDelete) return;
    const button = event.currentTarget;
    const deleteInfo = pendingDelete;
    setButtonBusy(button, true, '삭제 중…');
    try {
        if (deleteInfo.type === 'reservation') {
            const item = deleteInfo.item;
            await adminRequest('adminDeleteReservation', { row: item.row, date: item.date, slot: item.slot, name: item.name });
        } else if (deleteInfo.type === 'calendar') {
            const item = deleteInfo.item;
            await adminRequest('adminDeleteCalendarItem', { row: item.row, startDate: item.startDate, endDate: item.endDate, title: item.title });
        } else {
            const item = deleteInfo.item;
            await adminRequest('adminDeleteAvailability', { row: item.row, date: item.date });
        }
        closeConfirm();
        await loadAdminData();
        showMessage('global-message', 'Google Sheets에서 항목을 삭제했습니다.', true);
    } catch (error) {
        closeConfirm();
        if (error.code !== 'AUTH_REQUIRED') showMessage('global-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.getElementById('password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const currentPassword = document.getElementById('current-admin-password').value;
    const newPassword = document.getElementById('new-admin-password').value;
    const confirmation = document.getElementById('confirm-admin-password').value;
    const button = document.getElementById('password-submit');

    if (!currentPassword || !newPassword || !confirmation) {
        showMessage('password-message', '모든 비밀번호 항목을 입력해 주세요.');
        return;
    }
    if (newPassword !== confirmation) {
        showMessage('password-message', '새 비밀번호 확인이 일치하지 않습니다.');
        return;
    }

    setButtonBusy(button, true, '변경 중…');
    showMessage('password-message', '');
    try {
        await adminRequest('adminChangePassword', { currentPassword, newPassword });
        clearAdminSession();
        showLoginView('관리자 비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인해 주세요.');
    } catch (error) {
        if (error.code !== 'AUTH_REQUIRED') showMessage('password-message', errorMessage(error.code));
    } finally {
        setButtonBusy(button, false, '');
    }
});

document.addEventListener('keydown', event => {
    const backdrop = document.getElementById('confirm-backdrop');
    if (backdrop.classList.contains('hidden')) return;
    if (event.key === 'Escape') closeConfirm();
    if (event.key === 'Tab') {
        const cancelButton = document.getElementById('confirm-cancel');
        const deleteButton = document.getElementById('confirm-delete');
        if (event.shiftKey && document.activeElement === cancelButton) {
            event.preventDefault();
            deleteButton.focus();
        } else if (!event.shiftKey && document.activeElement === deleteButton) {
            event.preventDefault();
            cancelButton.focus();
        }
    }
});

if (adminToken) {
    showDashboardView();
    loadAdminData();
} else {
    showLoginView();
}
