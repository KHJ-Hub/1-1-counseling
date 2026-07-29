const GAS_URL = "https://script.google.com/macros/s/AKfycbxb_Ed3RuWJ0Coh_JKBHaPWZxZvJUUY1JqC4XOYnAv6WWyX1oFs3EawJ-m6aEaew_FVvA/exec";

let sheetHolidays = [];
let publicHolidays = [];
let vacationDates = [];
let dateAvailability = {};
let dateOperationTypes = {};
let slotTimes = {};
let serviceOperating = true;
let calendar;
let selectedBookingDate = "";
let selectedCancelEvent = null;
let isSubmitting = false;
let reloadAfterNotice = false;
let previouslyFocusedElement = null;
let pendingModalTrigger = null;

const modalBackdrop = document.getElementById('modal-backdrop');
const modalPanels = document.querySelectorAll('.modal-panel');
const bookingForm = document.getElementById('booking-form');
const cancelForm = document.getElementById('cancel-form');

class HttpError extends Error {
    constructor(status) {
        super('HTTP ' + status);
        this.name = 'HttpError';
        this.status = status;
    }
}

function getSeoulDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = {};
    parts.forEach(part => {
        if (part.type !== 'literal') values[part.type] = part.value;
    });
    return `${values.year}-${values.month}-${values.day}`;
}

function markSelectedCalendarDate(dayElement) {
    document.querySelectorAll('.fc-daygrid-day.is-selected-day').forEach(element => {
        element.classList.remove('is-selected-day');
    });
    if (dayElement) dayElement.classList.add('is-selected-day');
}

function getMobileEventLabel(title) {
    if (title.endsWith("대체공휴일")) return "대체휴일";
    const labels = {
        "여름방학": "방학",
        "여름방학식": "방학식",
        "문화예술체험": "문화체험",
        "상담완료": "완료",
        "상담 가능": "가능",
        "상담 불가": "불가",
        "🚨예약 마감🚨": "마감"
    };
    return labels[title] || title;
}

function normalizePublicHolidayTitle(title) {
    const cleanedTitle = (title || "").replace(/🚫/g, "").trim();
    if (cleanedTitle.includes("대체공휴일")) return cleanedTitle;
    const substituteMatch = cleanedTitle.match(/^쉬는 날\s+(.+)$/);
    return substituteMatch ? `${substituteMatch[1]} 대체공휴일` : cleanedTitle;
}

function openModal(panelId, focusElement) {
    if (modalBackdrop.classList.contains('hidden')) {
        previouslyFocusedElement = pendingModalTrigger || document.activeElement;
        pendingModalTrigger = null;
    }

    modalPanels.forEach(panel => panel.classList.add('hidden'));
    document.getElementById(panelId).classList.remove('hidden');
    modalBackdrop.classList.remove('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    setTimeout(() => focusElement && focusElement.focus(), 0);
}

function setModalTrigger(element) {
    if (!element) return;
    pendingModalTrigger = element;
    if (!element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '-1');
    }
}

function closeModal(forceClose = false) {
    if (isSubmitting && !forceClose) return;

    modalBackdrop.classList.add('hidden');
    modalBackdrop.setAttribute('aria-hidden', 'true');
    modalPanels.forEach(panel => panel.classList.add('hidden'));
    document.body.classList.remove('modal-open');

    if (reloadAfterNotice) {
        reloadAfterNotice = false;
        location.reload();
        return;
    }

    if (previouslyFocusedElement && document.contains(previouslyFocusedElement)) {
        previouslyFocusedElement.focus();
    }
    previouslyFocusedElement = null;
}

function showNotice(title, message, shouldReload = false) {
    document.getElementById('notice-title').textContent = title;
    document.getElementById('notice-message').textContent = message;
    reloadAfterNotice = shouldReload;
    openModal('notice-modal', document.getElementById('notice-confirm'));
}

function showFormMessage(elementId, message) {
    const element = document.getElementById(elementId);
    element.textContent = message;
    element.classList.toggle('hidden', !message);
}

function setSubmitting(form, submitting, submittingText) {
    isSubmitting = submitting;
    form.setAttribute('aria-busy', String(submitting));

    const submitButton = form.querySelector('[type="submit"]');
    const controls = form.querySelectorAll('input, button');
    controls.forEach(control => {
        if (submitting) {
            control.dataset.wasDisabled = String(control.disabled);
            control.disabled = true;
        } else {
            control.disabled = control.dataset.wasDisabled === 'true';
            delete control.dataset.wasDisabled;
        }
    });

    if (!submitButton.dataset.originalText) {
        submitButton.dataset.originalText = submitButton.textContent;
    }
    submitButton.textContent = submitting ? submittingText : submitButton.dataset.originalText;
}

function getAvailableSlots(dateStr) {
    if (!serviceOperating) return [];
    const configured = dateAvailability[dateStr];
    const operationType = dateOperationTypes[dateStr] || (vacationDates.includes(dateStr) ? 'vacation' : 'semester');
    if (operationType === 'closed') return [];
    if (!configured) return operationType === 'vacation' ? [] : ['야자 1차시', '야자 2차시', '야자 3차시'];
    return Object.keys(configured).filter(slot => configured[slot] === true);
}

function openBookingModal(dateStr, occupiedSlots, availableSlots) {
    selectedBookingDate = dateStr;
    bookingForm.reset();
    showFormMessage('booking-message', '');
    document.getElementById('booking-date-display').textContent = dateStr;

    let firstAvailableInput = null;
    const slotList = document.getElementById('booking-slot-list');
    slotList.replaceChildren();
    const operationType = dateOperationTypes[dateStr] || (vacationDates.includes(dateStr) ? 'vacation' : 'semester');
    const slots = operationType === 'vacation' ? ['자습 1차시', '자습 2차시', '자습 3차시', '자습 4차시'] : ['야자 1차시', '야자 2차시', '야자 3차시'];
    slots.forEach(slot => {
        const option = document.createElement('label'); option.className = 'slot-option'; option.dataset.slotOption = '';
        const input = document.createElement('input'); input.type = 'radio'; input.name = 'booking-slot'; input.value = slot;
        const label = document.createElement('span'); label.className = 'slot-name'; label.textContent = slot;
        const time = document.createElement('span'); time.className = 'slot-time';
        time.textContent = slotTimes[slot] ? `${slotTimes[slot].start}~${slotTimes[slot].end}` : '';
        const status = document.createElement('span'); status.className = 'slot-status';
        option.append(input, label, time, status); slotList.appendChild(option);
        const occupied = occupiedSlots.includes(input.value);
        const unavailable = !availableSlots.includes(input.value);
        input.disabled = occupied || unavailable;
        option.classList.toggle('disabled', occupied || unavailable);
        option.dataset.state = unavailable ? 'unavailable' : (occupied ? 'occupied' : 'available');
        status.textContent = unavailable ? '잠김' : (occupied ? '마감' : '');

        if (!occupied && !unavailable && !firstAvailableInput) firstAvailableInput = input;
    });

    if (firstAvailableInput) firstAvailableInput.checked = true;
    openModal('booking-modal', firstAvailableInput || document.getElementById('booking-name'));
}

function openCancelModal(eventDate, eventSlot, eventName) {
    selectedCancelEvent = { date: eventDate, slot: eventSlot, name: eventName };
    cancelForm.reset();
    showFormMessage('cancel-message', '');
    document.getElementById('cancel-description').textContent =
        '[' + eventSlot + '] ' + eventName + ' 상담 예약을 취소합니다.';
    openModal('cancel-modal', document.getElementById('cancel-password'));
}

function trapModalFocus(event) {
    if (event.key !== 'Tab' || modalBackdrop.classList.contains('hidden')) return;

    const activePanel = Array.from(modalPanels).find(panel => !panel.classList.contains('hidden'));
    if (!activePanel) return;

    const focusableElements = Array.from(activePanel.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ));
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
    }
}

document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal());
});

document.getElementById('notice-confirm').addEventListener('click', () => closeModal());

modalBackdrop.addEventListener('click', event => {
    if (event.target === modalBackdrop) closeModal();
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modalBackdrop.classList.contains('hidden')) {
        closeModal();
        return;
    }
    trapModalFocus(event);
});

bookingForm.addEventListener('submit', event => {
    event.preventDefault();
    if (isSubmitting) return;

    const selectedSlot = bookingForm.querySelector('input[name="booking-slot"]:checked');
    const name = document.getElementById('booking-name').value;
    const password = document.getElementById('booking-password').value;
    const pwdTrimmed = password.trim();

    if (!selectedSlot || selectedSlot.disabled) {
        showFormMessage('booking-message', '예약 가능한 상담 시간을 선택해 주세요.');
        return;
    }
    if (!name || name.trim() === '') {
        showFormMessage('booking-message', '신청자 이름을 입력해 주세요.');
        document.getElementById('booking-name').focus();
        return;
    }
    if (!/^\d{4}$/.test(pwdTrimmed)) {
        showFormMessage('booking-message', '비밀번호는 숫자 4자리로 입력해 주세요.');
        document.getElementById('booking-password').focus();
        return;
    }

    showFormMessage('booking-message', '');
    setSubmitting(bookingForm, true, '신청 처리 중…');
    sendData({ action: "save", date: selectedBookingDate, slot: selectedSlot.value, name: name, password: pwdTrimmed }, 'booking');
});

cancelForm.addEventListener('submit', event => {
    event.preventDefault();
    if (isSubmitting || !selectedCancelEvent) return;

    const pwdCheck = document.getElementById('cancel-password').value;
    if (!pwdCheck || pwdCheck.trim() === '') {
        showFormMessage('cancel-message', '예약 비밀번호 또는 관리자 비밀번호를 입력해 주세요.');
        document.getElementById('cancel-password').focus();
        return;
    }

    showFormMessage('cancel-message', '');
    setSubmitting(cancelForm, true, '취소 처리 중…');
    sendData({
        action: "delete",
        date: selectedCancelEvent.date,
        slot: selectedCancelEvent.slot,
        name: selectedCancelEvent.name,
        password: pwdCheck
    }, 'cancel');
});

document.addEventListener('DOMContentLoaded', async function() {
    try {
        const response = await fetch(GAS_URL);
        if (!response.ok) throw new HttpError(response.status);
        const data = await response.json();

        sheetHolidays = data.holidays || [];
        publicHolidays = data.publicHolidays || [];
        vacationDates = data.vacationDates || [];
        dateAvailability = data.availability || {};
        dateOperationTypes = data.operationTypes || {};
        slotTimes = data.slotTimes || {};
        const serviceSettings = data.serviceSettings || {};
        serviceOperating = serviceSettings.operating !== false;
        const schoolYear = serviceSettings.schoolYear || 2026;
        const className = serviceSettings.className || '1학년 1반';
        document.title = `학생 상담 신청 | ${schoolYear}학년도 · ${className}`;
        document.getElementById('student-service-title').textContent = '학생 상담 신청';
        document.getElementById('student-service-eyebrow').textContent = `${schoolYear}학년도 · ${className}`;
        document.getElementById('student-service-notice').textContent = serviceOperating
            ? (serviceSettings.studentNotice || '편한 날짜와 시간을 골라 상담을 신청해 주세요.')
            : '현재 상담 신청을 잠시 중지했습니다.';
        document.getElementById('vacation-guide').textContent = serviceSettings.vacationNotice || '방학 중에는 선생님이 열어둔 날짜와 시간만 신청할 수 있어요.';
        document.getElementById('booking-password-help').textContent = serviceSettings.passwordNotice || '예약 취소 시 사용할 숫자 4자리를 입력해 주세요.';
        let dateCounts = {};

        data.events.forEach(ev => {
            if (ev.extendedProps && ev.extendedProps.type === "holiday") {
                const isPublicHoliday = publicHolidays.includes(ev.start);
                ev.classNames = [isPublicHoliday ? 'public-holiday-event' : 'holiday-event'];
                ev.title = isPublicHoliday
                    ? normalizePublicHolidayTitle(ev.title)
                    : (ev.title || "").replace(/🚫/g, "").trim();
            } else if (ev.extendedProps && ev.extendedProps.type === "consult") {
                ev.classNames = ev.extendedProps.completed ? ['consult-event', 'completed-consult-event'] : ['consult-event'];
                dateCounts[ev.start] = (dateCounts[ev.start] || 0) + 1;
            } else if (ev.extendedProps && ev.extendedProps.type === "vacation") {
                ev.classNames = ['vacation-event'];
            }
        });

        for (let dStr in dateCounts) {
            const availableCount = getAvailableSlots(dStr).length;
            if (availableCount > 0 && dateCounts[dStr] >= availableCount) {
                data.events.push({
                    title: "🚨예약 마감🚨",
                    start: dStr,
                    allDay: true,
                    backgroundColor: "#ff8787",
                    borderColor: "#ff8787",
                    textColor: "white",
                    classNames: ['closed-event'],
                    extendedProps: { type: "closed", slot: "마감" }
                });
            }
        }

        var calendarEl = document.getElementById('calendar');
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            locale: 'ko',
            buttonText: { today: '오늘' },
            headerToolbar: { left: 'today', center: 'prev title next', right: '' },
            contentHeight: 'auto',
            dayMaxEvents: 3,

            dayCellDidMount: function(info) {
                const dateStr = info.el.dataset.date;
                const day = info.date.getDay();
                const availableSlotCount = getAvailableSlots(dateStr).length;
                const isPastDate = dateStr < getSeoulDateString();
                if (isPastDate) info.el.classList.add('is-past-day');
                if (day === 0 || day === 6) info.el.classList.add('is-weekend-day');
                if (sheetHolidays.includes(dateStr)) info.el.classList.add('is-blocked-day');
                else if (vacationDates.includes(dateStr)) info.el.classList.add('is-vacation-day');
                if (publicHolidays.includes(dateStr)) info.el.classList.add('is-holiday-date');
                if (!isPastDate && day !== 0 && day !== 6 && !sheetHolidays.includes(dateStr) && availableSlotCount > (dateCounts[dateStr] || 0)) {
                    info.el.classList.add('is-bookable-day');
                }
            },

            eventOrder: function(a, b) {
                if (a.extendedProps.type === 'holiday' && b.extendedProps.type !== 'holiday') return -1;
                if (b.extendedProps.type === 'holiday' && a.extendedProps.type !== 'holiday') return 1;
                let slotA = a.extendedProps.slot || "";
                let slotB = b.extendedProps.slot || "";
                if (slotA < slotB) return -1;
                if (slotA > slotB) return 1;
                return 0;
            },

            events: data.events,

            eventContent: function(info) {
                const label = document.createElement('span');
                label.className = 'fc-event-title';

                const desktopLabel = document.createElement('span');
                desktopLabel.className = 'event-label-desktop';
                desktopLabel.textContent = info.event.title;

                const mobileLabel = document.createElement('span');
                mobileLabel.className = 'event-label-mobile';
                mobileLabel.textContent = getMobileEventLabel(info.event.title);

                label.append(desktopLabel, mobileLabel);
                return { domNodes: [label] };
            },

            eventDidMount: function(info) {
                info.el.title = info.event.title;
                info.el.setAttribute('aria-label', info.event.title);
            },

            dateClick: function(info) {
                if (info.dateStr < getSeoulDateString()) {
                    setModalTrigger(info.dayEl);
                    showNotice("예약 불가 안내", "지난 날짜에는 상담을 신청할 수 없습니다.");
                    return;
                }

                var dateObj = new Date(info.dateStr + "T00:00:00+09:00");
                var dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 0 || dayOfWeek === 6) {
                    showNotice("주말 예약 불가", "주말에는 상담을 예약할 수 없습니다.");
                    return;
                }

                if (sheetHolidays.includes(info.dateStr)) {
                    showNotice("상담 불가 안내", "해당 날짜는 상담이 불가능한 날입니다.");
                    return;
                }

                var dayEvents = calendar.getEvents().filter(ev => ev.startStr === info.dateStr && ev.extendedProps.type === "consult");
                var occupiedSlots = dayEvents.map(ev => ev.extendedProps.slot);
                var availableSlots = getAvailableSlots(info.dateStr);

                if (availableSlots.length === 0) {
                    showNotice("상담 불가 안내", "해당 날짜에는 상담 가능한 시간이 없습니다.");
                    return;
                }

                if (availableSlots.every(slot => occupiedSlots.includes(slot))) {
                    showNotice("예약 마감", "해당 날짜의 상담 예약이 모두 마감되었습니다.");
                    return;
                }

                markSelectedCalendarDate(info.dayEl);
                setModalTrigger(info.dayEl);
                openBookingModal(info.dateStr, occupiedSlots, availableSlots);
            },

            eventClick: function(info) {
                if (["holiday", "vacation", "closed"].includes(info.event.extendedProps.type)) return;
                if (info.event.extendedProps.completed) {
                    showNotice("취소 불가", "이미 완료된 상담은 취소할 수 없습니다.");
                    return;
                }
                var eventDate = info.event.startStr;
                var eventSlot = info.event.extendedProps.slot;
                var eventName = info.event.extendedProps.name;

                setModalTrigger(info.el);
                openCancelModal(eventDate, eventSlot, eventName);
            }
        });
        calendar.render();
        document.getElementById('loading').style.display = 'none';
    } catch (error) {
        console.error("데이터 로드 중 에러:", error);
        document.getElementById('loading').style.display = 'none';
        if (error instanceof HttpError) {
            showNotice("서버 오류", "서버에서 달력 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } else {
            showNotice("연결 오류", "인터넷 연결을 확인한 뒤 잠시 후 다시 시도해 주세요.");
        }
    }
});

function sendData(payload, requestType) {
    fetch(GAS_URL, { method: 'POST', body: JSON.stringify(payload) })
    .then(res => {
        if (!res.ok) throw new HttpError(res.status);
        return res.text();
    })
    .then(result => {
        const activeForm = requestType === 'cancel' ? cancelForm : bookingForm;
        const messageId = requestType === 'cancel' ? 'cancel-message' : 'booking-message';
        setSubmitting(activeForm, false, '');

        if (result === "DUPLICATE_WEEKLY") {
            showFormMessage(messageId, "이미 이번 주에 상담 신청 내역이 있습니다. 상담은 일주일에 한 번만 신청할 수 있습니다.");
        } else if (result === "PAST_DATE_NOT_ALLOWED") {
            showFormMessage(messageId, "지난 날짜에는 상담을 신청할 수 없습니다.");
        } else if (result === "SLOT_TAKEN") {
            showFormMessage(messageId, "방금 다른 학생이 이 시간을 예약했습니다. 새로고침 후 다른 시간을 선택해 주세요.");
        } else if (result === "SLOT_UNAVAILABLE" || result === "DATE_BLOCKED") {
            showFormMessage(messageId, "현재 선택한 날짜 또는 시간에는 상담을 신청할 수 없습니다. 새로고침 후 다시 확인해 주세요.");
        } else if (result === "WEEKEND_NOT_ALLOWED") {
            showFormMessage(messageId, "주말에는 상담을 예약할 수 없습니다.");
        } else if (result === "SERVICE_PAUSED") {
            showFormMessage(messageId, "현재 상담 신청이 일시 중지되어 있습니다.");
        } else if (result && result.indexOf("HOLIDAY_NOT_ALLOWED:") === 0) {
            const reason = result.split(":")[1] || "공휴일";
            showFormMessage(messageId, reason + "에는 상담을 예약할 수 없습니다.");
        } else if (result === "INVALID_DATE" || result === "INVALID_SLOT" || result === "INVALID_PASSWORD" || result === "INVALID_NAME" || result === "NAME_REQUIRED") {
            showFormMessage(messageId, "입력 내용을 확인한 뒤 다시 시도해 주세요.");
        } else if (result === "WRONG_PASSWORD") {
            showFormMessage(messageId, "비밀번호가 일치하지 않습니다. 다시 확인해 주세요.");
        } else if (result === "COMPLETED_RESERVATION") {
            showFormMessage(messageId, "이미 완료된 상담은 취소할 수 없습니다.");
        } else if (result === "Success") {
            showNotice("처리 완료", requestType === 'cancel' ? "상담 예약이 취소되었습니다." : "상담 예약이 신청되었습니다.", true);
        } else {
            showFormMessage(messageId, "서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
    })
    .catch(err => {
        const activeForm = requestType === 'cancel' ? cancelForm : bookingForm;
        const messageId = requestType === 'cancel' ? 'cancel-message' : 'booking-message';
        setSubmitting(activeForm, false, '');
        console.error("요청 처리 중 에러:", err);

        if (err instanceof HttpError) {
            showFormMessage(messageId, "서버에서 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        } else {
            showFormMessage(messageId, "서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
        }
    });
}
