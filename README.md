# 1학년 1반 상담 예약

Google Apps Script와 Google Sheets를 사용하는 상담 예약 사이트입니다. 학생은 기존 달력에서 상담을 예약·취소하고, 교사는 관리자 화면에서 예약·상담 기록·학사일정·상담 가능 시간·통계·외부 연동 상태를 관리합니다.

## 파일 구조

- `index.html`, `styles.css`, `script.js`: 학생 예약 화면
- `admin.html`, `admin.css`, `admin.js`: 교사용 관리자 화면
- `apps-script/Code.gs`: Google Sheets, 관리자 인증, Discord, Google Calendar, 자동 알림 서버
- `AGENTS.md`: 프로젝트 작업 규칙

학생 화면과 관리자 화면은 같은 기존 Google Apps Script 웹 앱 URL을 사용합니다. 학생용 `save`·`delete` 요청 필드와 응답 문자열은 유지합니다.

## Google Sheets 구조

시트 이름과 기존 열을 이동하거나 변경하지 마세요.

### 상담신청현황

| 열 | 헤더 | 설명 |
|---|---|---|
| A | 날짜 | 예약 날짜 |
| B | 시간 | `야자 1차시`·`야자 2차시`·`야자 3차시` |
| C | 이름 | 학생 이름 |
| D | 비밀번호 | 학생 예약 비밀번호 |
| E | 상담완료 | `TRUE/FALSE` |
| F | 상담메모 | 관리자용 일반 텍스트 메모 |
| G | Calendar Event ID | 연결된 Google Calendar 이벤트 ID |

Google Calendar를 사용하려면 **G1에 정확히 `Calendar Event ID`를 직접 입력**하세요. 코드는 헤더나 열을 자동 생성하지 않습니다. G열이 없거나 헤더가 다르면 예약은 정상 저장되고 Calendar 연동만 건너뜁니다. 학생 비밀번호와 상담 메모는 Discord·Calendar·통계 응답에 포함되지 않습니다.

### 학사일정

| 열 | 헤더 | 설명 |
|---|---|---|
| A | 시작일 | 일정 시작일 |
| B | 종료일 | 일정 종료일 |
| C | 일정명 | 학사일정 이름 또는 `상담불가` |

모든 학사일정 기간은 기존 규칙대로 학생 상담 불가 기간입니다.

### 상담가능시간

| 열 | 헤더 | 값 |
|---|---|---|
| A | 날짜 | 날짜 |
| B | 야자 1차시 | `TRUE/FALSE` |
| C | 야자 2차시 | `TRUE/FALSE` |
| D | 야자 3차시 | `TRUE/FALSE` |

행이 없는 날짜는 세 시간 모두 가능한 것으로 처리합니다.

## Script Properties

Apps Script 편집기의 **프로젝트 설정 → 스크립트 속성**에서 설정합니다. 비밀값은 코드나 Git 저장소에 기록하지 마세요.

| 속성 | 형식 | 설명 |
|---|---|---|
| `ADMIN_PASSWORD_SETUP` | 임시 평문 | 최초 관리자 비밀번호 설정 때만 사용 후 자동 삭제 |
| `DISCORD_WEBHOOK_URL` | Discord Webhook URL | Discord 알림 대상, 미설정 시 알림만 생략 |
| `ADMIN_PAGE_URL` | HTTPS URL | 관리자 링크, 미설정 시 `https://khj-hub.github.io/1-1-counseling/admin.html` |
| `DISCORD_SLOT_START_ENABLED` | `true/false` | 야자 차시 시작 알림 활성화 |
| `DISCORD_DAILY_SUMMARY_ENABLED` | `true/false` | 오늘·내일 요약 활성화 |
| `GOOGLE_CALENDAR_ENABLED` | `true/false` | Google Calendar 연동 활성화 |
| `GOOGLE_CALENDAR_ID` | Calendar ID | 연동할 캘린더 ID, 브라우저에 노출하지 않음 |
| `SLOT_1_START` / `SLOT_1_END` | `HH:mm` | 야자 1차시 시작·종료 |
| `SLOT_2_START` / `SLOT_2_END` | `HH:mm` | 야자 2차시 시작·종료 |
| `SLOT_3_START` / `SLOT_3_END` | `HH:mm` | 야자 3차시 시작·종료 |

시간 예시는 `18:40`/`19:30`, `19:40`/`20:30`, `20:40`/`21:30`입니다. 실제 학교 시간표를 입력하세요. 시간값이 없거나 잘못되면 예약은 유지되고 Calendar 등록과 차시 시작 알림만 생략됩니다.

관리자 비밀번호 초기화 절차:

1. `ADMIN_PASSWORD_SETUP`에 초기 비밀번호를 임시 입력합니다.
2. 편집기에서 `initializeAdminPassword()`를 한 번 실행하고 권한을 승인합니다.
3. `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, `ADMIN_AUTH_VERSION` 생성과 `ADMIN_PASSWORD_SETUP` 자동 삭제를 확인합니다.

## Discord 알림

예약·취소 알림은 Embed로 전송하며 관리자 페이지 링크를 포함합니다. 차시 시작 알림은 같은 날짜·차시의 학생을 한 메시지로 묶고, 예약이 없으면 보내지 않습니다. 오늘 요약은 오전 8시 전후, 내일 요약은 오후 7시 전후에 전송됩니다. 각 자동 알림은 Script Properties에 전송 상태를 저장해 같은 날짜에 중복 발송하지 않습니다.

Discord 장애나 Webhook 미설정은 예약·취소 결과를 바꾸지 않습니다. 학생 비밀번호와 상담 메모는 전송하지 않습니다.

수동 테스트 함수:

- `testDiscordNotification()`: 기본 Webhook 테스트
- `testTodayCounselingSummary()`: 오늘 요약 테스트
- `testTomorrowCounselingSummary()`: 내일 요약 테스트
- `testSlotStartNotification()`: 현재 시각과 무관한 차시 시작 테스트

관리자 설정 탭의 테스트 버튼도 동일 기능을 서버 인증 후 실행합니다.

## Google Calendar 연동

Google Calendar 설정에서 대상 캘린더의 **캘린더 통합 → 캘린더 ID**를 확인해 `GOOGLE_CALENDAR_ID`에 입력합니다. 배포·트리거 실행 계정이 해당 캘린더를 조회·수정할 권한을 가져야 합니다.

Calendar 연동 코드를 처음 실행하면 Apps Script가 Calendar 읽기·수정 권한 승인을 요청합니다. 설치형 트리거는 트리거를 만든 계정의 권한으로 실행됩니다. 프로젝트가 명시적 `appsscript.json` 범위를 사용한다면 Calendar 범위 `https://www.googleapis.com/auth/calendar`도 포함해야 합니다.

예약 성공 시 `[학생 상담] 학생 이름` 이벤트를 만들고 G열에 이벤트 ID를 저장합니다. 취소 시 연결 이벤트를 삭제하며, 상담 완료 상태가 바뀌면 제목의 `[완료]` 접두사를 갱신합니다. Calendar 장애는 Sheets 예약·취소·완료 저장을 롤백하지 않습니다.

기존 예약 동기화:

1. G1 헤더와 Calendar Script Properties를 먼저 설정합니다.
2. `syncExistingReservationsToCalendar()`를 편집기에서 직접 실행합니다.
3. 반환된 `created`, `skipped`, `failed` 수와 G열을 확인합니다.
4. G열에 ID가 있는 예약은 건너뛰므로 중복 생성하지 않습니다.

## 자동 트리거

1. Apps Script 편집기에서 `installCounselingTriggers()`를 선택해 한 번 실행합니다.
2. 권한을 승인합니다.
3. 왼쪽 **트리거**에서 다음 세 핸들러를 확인합니다.
   - `checkCounselingSlotStartNotifications`: 5분 간격
   - `runTodayCounselingSummary`: 매일 오전 8시 전후
   - `runTomorrowCounselingSummary`: 매일 오후 7시 전후
4. 관리자 설정 화면에서 “Apps Script 트리거: 설정됨”을 확인합니다.

재실행 시 이 기능의 트리거만 제거하고 다시 만들므로 중복되지 않습니다. `removeCounselingTriggers()`는 위 세 핸들러만 삭제하며 프로젝트의 다른 트리거는 삭제하지 않습니다.

Apps Script 시간 기반 트리거는 정확한 정각 실행을 보장하지 않습니다. 일일 트리거의 `nearMinute(0)`에는 약 ±15분 오차가 있을 수 있습니다. 차시 알림은 5분 간격 점검 방식이므로 설정한 시작 시각부터 최대 약 4분 내 전송될 수 있습니다.

## 관리자 화면

- 예약 조회·검색·삭제, 상담 완료·메모
- 학생별 상담 이력
- 학사일정과 상담 불가 기간 CRUD
- 날짜별 상담 가능 시간
- 날짜·학생·완료 필터를 적용한 상담 통계와 CSS 막대그래프
- Discord·Calendar·시간·트리거 설정 여부 확인과 알림 테스트
- 관리자 비밀번호 변경

통계 action은 기존 관리자 세션 검증을 통과해야 하며 비밀번호·메모를 응답하지 않습니다. 설정 화면도 비밀 URL이나 Calendar ID 원문을 응답하지 않습니다.

## Apps Script 반영 및 재배포

1. 현재 Sheets와 Apps Script 정상 버전을 백업합니다.
2. `상담신청현황` G1에 `Calendar Event ID`를 추가합니다.
3. Script Properties를 설정합니다.
4. 저장소의 `apps-script/Code.gs` 전체를 연결된 Apps Script 프로젝트에 붙여넣고 저장합니다.
5. `testDiscordNotification()`과 필요한 Calendar/트리거 함수 실행 시 권한을 승인합니다.
6. `installCounselingTriggers()`를 실행하고 트리거 목록을 확인합니다.
7. 필요하면 `syncExistingReservationsToCalendar()`를 한 번 실행합니다.
8. **배포 → 배포 관리 → 기존 웹 앱 배포 편집 → 새 버전**을 선택해 배포합니다.
9. 실행 사용자와 접근 권한은 현재 운영 설정을 유지합니다.
10. 새 배포 ID를 만들지 말고 기존 배포를 업데이트해 웹 앱 URL을 유지합니다.
11. 학생 조회·신청·취소 후 관리자 기능과 실행 로그를 확인합니다.

연동 실패 시 Apps Script 왼쪽 **실행** 메뉴의 `console.error` 기록, Script Properties, 트리거 소유 계정, 캘린더 공유 권한, G1 헤더를 확인합니다. 로그에 Webhook URL이나 Calendar ID 원문을 남기지 않습니다.

## 되돌리기

1. `removeCounselingTriggers()`를 실행해 이번 기능의 트리거만 제거합니다.
2. `DISCORD_SLOT_START_ENABLED`, `DISCORD_DAILY_SUMMARY_ENABLED`, `GOOGLE_CALENDAR_ENABLED`를 `false`로 바꿉니다.
3. 배포 관리에서 이전 정상 Apps Script 버전으로 되돌립니다.
4. G열은 기존 A~F에 영향을 주지 않으므로 데이터 보존을 위해 그대로 두고, 삭제가 필요하면 먼저 별도 백업합니다.

## 보안·개인정보

- 기존 호환을 위해 학생 이름은 학생 달력에 그대로 표시됩니다. 사이트 접근 범위를 필요한 사용자로 제한하세요.
- 학생 비밀번호는 학생 취소 검증에만 사용하고 관리자·통계·Discord·Calendar 응답에 노출하지 않습니다.
- 상담 메모에는 건강정보·연락처 등 민감정보를 입력하지 마세요.
- 모든 관리자 action은 Apps Script 서버에서 30분 세션을 다시 검증합니다.
- 내부 예외 상세와 비밀 설정값은 브라우저에 반환하지 않습니다.

## 수동 테스트 체크리스트

### 학생 회귀

- 예약 조회·신청·주 1회 제한·동일 시간 중복 방지
- 올바른 비밀번호 취소와 잘못된 비밀번호 거부
- 모든 학사일정 예약 차단과 날짜별 가능 시간 적용
- 외부 연동 미설정·장애 상태에서도 예약·취소 성공 응답 유지

### 관리자

- 로그인·세션 만료·예약 삭제·상담 완료·메모·학생 이력
- 학사일정·상담 불가·가능 시간 CRUD
- 통계 날짜 범위·학생·완료 필터와 완료율·요일·시간대·월별 집계
- 인증 없는 통계·설정·테스트 action 차단
- 통계 응답에 D열 비밀번호와 F열 메모가 없는지 확인

### 외부 연동

- 예약·취소 Embed와 관리자 링크, Webhook 미설정·장애
- 차시 알림 1회 발송·학생 묶음·빈 차시 생략·취소 학생 제외
- 오늘·내일 요약 중복 방지
- Calendar 생성·중복 방지·취소 삭제·완료 제목·기존 예약 동기화
- Calendar 미설정·권한 오류에도 예약 정상 처리

### UI

- PC와 390px 모바일에서 가로 넘침이 없는지 확인
- 통계 카드·세로 막대·설정 상태가 읽기 쉬운지 확인
- Tab 키 포커스와 기존 삭제 확인창 ESC 닫기 확인

## 로컬 확인

```sh
python -m http.server 4173
```

`http://127.0.0.1:4173/`과 `http://127.0.0.1:4173/admin.html`을 확인합니다. 실제 Sheets·Discord·Calendar 테스트는 `Code.gs`를 기존 웹 앱에 재배포한 뒤 수행해야 합니다.
