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
let pendingDelete = null;
let confirmTrigger = null;

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
        TITLE_TOO_LONG: '학사일정 이름은 100자 이하로 입력해 주세요.',
        NAME_REQUIRED: '학생 이름을 입력해 주세요.',
        INVALID_COMPLETED: '상담 완료 상태를 확인해 주세요.',
        MEMO_TOO_LONG: '상담 메모는 2,000자 이하로 입력해 주세요.',
        INVALID_AVAILABILITY: '상담 가능 시간 설정을 확인해 주세요.',
        AVAILABILITY_EXISTS: '해당 날짜의 설정이 이미 있습니다. 기존 항목을 수정해 주세요.',
        WRONG_CURRENT_PASSWORD: '현재 관리자 비밀번호가 올바르지 않습니다.',
        ADMIN_PASSWORD_POLICY: '관리자 비밀번호는 4자 이상 64자 이하로 입력해 주세요.',
        INVALID_ACTION: '지원하지 않는 관리자 작업입니다.',
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
        list.appendChild(createTextElement('p', 'empty-state', '별도로 설정된 날짜가 없습니다. 모든 날짜에 세 시간이 기본 적용됩니다.'));
        return;
    }

    availabilityItems.forEach(item => {
        const article = document.createElement('article');
        article.className = 'list-item availability-item';
        article.appendChild(createTextElement('div', 'item-title', item.date));
        const enabled = item.slots.map((value, index) => value ? `야자 ${index + 1}차시` : '').filter(Boolean);
        article.appendChild(createTextElement('div', 'item-meta', enabled.length ? enabled.join(', ') : '가능 시간 없음'));
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
        article.appendChild(createTextElement('div', 'item-title', item.date));
        article.appendChild(createTextElement('div', 'item-meta', item.slot));
        article.appendChild(createTextElement('div', item.completed ? 'status-complete' : 'status-pending', item.completed ? '완료' : '미완료'));
        article.appendChild(createTextElement('div', 'item-meta', item.memo || '메모 없음'));
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

async function loadAdminData(showSuccess = false) {
    const refreshButton = document.getElementById('refresh-button');
    setButtonBusy(refreshButton, true, '불러오는 중…');
    showMessage('global-message', '');
    try {
        const [reservationResult, calendarResult, availabilityResult] = await Promise.all([
            adminRequest('adminListReservations'),
            adminRequest('adminListCalendarItems'),
            adminRequest('adminListAvailability')
        ]);
        reservations = reservationResult.reservations || [];
        calendarItems = calendarResult.items || [];
        availabilityItems = availabilityResult.items || [];
        renderAllData();
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

document.getElementById('history-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = document.getElementById('history-name').value.trim();
    if (!name) {
        showMessage('history-message', '학생 이름을 입력해 주세요.');
        return;
    }
    loadStudentHistory(name);
});

function resetAvailabilityForm() {
    const form = document.getElementById('availability-form');
    form.reset();
    document.getElementById('availability-row').value = '';
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
    item.slots.forEach((value, index) => {
        document.getElementById(`availability-slot-${index + 1}`).checked = value;
    });
    form.dataset.expectedDate = item.date;
    document.getElementById('availability-submit').textContent = '설정 수정';
    document.getElementById('availability-cancel-edit').classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.getElementById('availability-cancel-edit').addEventListener('click', resetAvailabilityForm);
document.getElementById('availability-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = availabilityItems.find(entry => entry.row === Number(button.dataset.row));
    if (!item) return;
    if (button.dataset.action === 'edit-availability') startAvailabilityEdit(item);
    if (button.dataset.action === 'delete-availability') {
        openConfirm(`${item.date}의 상담 가능 시간 설정을 삭제할까요? 삭제하면 세 시간 모두 가능한 기본값이 적용됩니다.`, { type: 'availability', item }, button);
    }
});

document.getElementById('availability-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const row = document.getElementById('availability-row').value;
    const date = document.getElementById('availability-date').value;
    const slots = [1, 2, 3].map(index => document.getElementById(`availability-slot-${index}`).checked);
    const button = document.getElementById('availability-submit');
    if (!date) {
        showMessage('availability-message', '날짜를 입력해 주세요.');
        return;
    }

    const payload = { date, slots };
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
