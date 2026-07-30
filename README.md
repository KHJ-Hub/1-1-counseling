# 1학년 1반 상담 예약

Google Apps Script와 Google Sheets를 사용하는 상담 예약 사이트입니다. 학생은 기존 달력에서 상담을 예약·취소하고, 교사는 관리자 화면에서 예약·상담 기록·학사일정·상담 가능 시간·통계·외부 연동 상태를 관리합니다.

## 파일 구조

- `index.html`, `styles.css`, `script.js`: 학생 예약 화면
- `admin.html`, `admin.css`, `admin.js`: 교사용 관리자 화면
- `apps-script/Code.gs`: Google Sheets, 관리자 인증, Discord, Google Calendar, 자동 알림 서버
- `.clasp.json`, `apps-script/appsscript.json`: 기존 Apps Script 프로젝트 연결과 로컬 배포 설정
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
| E | 운영유형 | `semester`·`vacation`·`closed` (기존 빈 값은 `semester`) |
| F | 4차시 | 방학 자습 4차시 `TRUE/FALSE` |
| G | 비고 | 특강·회의·미출근 등 200자 이하 |

기존 A~D는 이동하지 않습니다. 학기 중 행이 없는 평일은 야자 1~3차시가 기본 가능하고, 학사일정 이름에 `방학`이 포함된 기간은 날짜별 `vacation` 설정으로 명시적으로 연 차시만 예약할 수 있습니다. `closed`는 모든 차시를 차단합니다. E1~G1 헤더가 없으면 기존 조회는 유지되지만 관리자 저장은 차단됩니다.

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
| `VACATION_SLOT_1_START` / `VACATION_SLOT_1_END` | `HH:mm` | 기본 `08:20` / `10:10` |
| `VACATION_SLOT_2_START` / `VACATION_SLOT_2_END` | `HH:mm` | 기본 `10:20` / `12:10` |
| `VACATION_SLOT_3_START` / `VACATION_SLOT_3_END` | `HH:mm` | 기본 `13:00` / `14:50` |
| `VACATION_SLOT_4_START` / `VACATION_SLOT_4_END` | `HH:mm` | 기본 `15:10` / `17:00` |

시간 예시는 `18:40`/`19:30`, `19:40`/`20:30`, `20:40`/`21:30`입니다. 실제 학교 시간표를 입력하세요. 시간값이 없거나 잘못되면 예약은 유지되고 Calendar 등록과 차시 시작 알림만 생략됩니다.

방학 시간 속성이 없으면 위 기본값을 사용합니다. `initializeVacationSlotProperties()`는 없는 속성만 추가하고 기존 값은 덮어쓰지 않으며, 확정값과 다른 기존 항목은 `different`로 반환합니다.

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
- 기간·요일별 상담 가능 시간 일괄 적용
- 학년도·학급명·화면 제목·학생 안내문·운영 상태 설정
- 학기·방학·상담 불가 운영 기간과 차시 시간표 설정
- 현재 운영 모드·다음 상담 가능일·외부 연동 상태 요약
- 날짜·학생·완료 필터를 적용한 상담 통계와 CSS 막대그래프
- Discord·Calendar·시간·트리거 설정 여부 확인과 알림 테스트
- 관리자 비밀번호 변경

통계 action은 기존 관리자 세션 검증을 통과해야 하며 비밀번호·메모를 응답하지 않습니다. 설정 화면도 비밀 URL이나 Calendar ID 원문을 응답하지 않습니다.

### 매년 운영 설정

관리자 **설정** 탭에서 학년도, 학급명, 학생·관리자 화면 제목, 학생 안내문, 운영 상태를 저장할 수 있습니다. 운영 상태를 `일시 중지`로 바꾸면 학생의 새 예약은 화면과 서버 양쪽에서 차단되며 기존 예약 조회·관리 데이터는 삭제되지 않습니다.

운영 기간은 기간 이름, 시작일, 종료일, 운영 유형으로 관리합니다. 별도 저장값이 없을 때만 다음 초기값을 사용합니다.

- 여름방학: `2026-07-21`~`2026-08-17`
- 개학일 안내값: `2026-08-18`

운영 기간의 날짜별 우선순위는 기존과 호환되도록 **상담가능시간의 명시적 날짜 설정 → 관리자 운영 기간 → 학사일정** 순서입니다. 방학 기간은 날짜별 가능 시간이 명시적으로 열린 날만 예약할 수 있습니다.

차시 시간은 관리자 설정값이 있으면 가장 먼저 사용하고, 없으면 기존 `SLOT_*`·`VACATION_SLOT_*` Script Properties를 사용합니다. 방학 시간 설정이 어느 쪽에도 없을 때는 기존 기본 시간인 `08:20~10:10`, `10:20~12:10`, `13:00~14:50`, `15:10~17:00`을 사용합니다. 기존 Script Properties는 관리자 설정 저장 시 덮어쓰거나 삭제하지 않습니다.

이 설정은 Script Property `COUNSELING_OPERATION_SETTINGS` 하나에 JSON으로 저장됩니다. 관리자 화면에서 자동 관리하므로 값을 Apps Script 편집기에서 직접 작성할 필요가 없으며, Discord Webhook·Calendar ID·관리자 비밀번호 같은 비밀값은 포함하지 않습니다.

### 기간 일괄 적용

관리자 **가능 시간** 탭에서 시작일·종료일, 적용 요일, 운영 유형, 차시, 비고를 선택해 기존 `상담가능시간` A~G 구조로 일괄 저장할 수 있습니다.

- 기본 정책은 `기존 설정 건너뛰기`로 기존 날짜 설정을 보호합니다.
- `기존 설정 덮어쓰기`는 확인창을 거친 뒤 선택된 날짜의 A~G만 갱신합니다.
- 한 요청은 선택 날짜 370개 이하로 제한됩니다.
- 기존 행 삭제나 예약 데이터 변경은 하지 않습니다.

### 새 학년도 준비

설정 탭의 안내에 따라 학년도·학급명·제목과 안내문을 먼저 바꾸고, 새 기간을 등록한 뒤 가능 시간을 구성합니다. 기존 예약과 상담 이력은 자동 삭제하지 않습니다. 현재 예약 시트에는 학년도 열을 추가하지 않았으므로 여러 학년의 기록을 한 시트에서 엄격히 분리해야 한다면 별도 데이터 마이그레이션 정책을 정한 후 확장해야 합니다.

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

## 로컬 clasp 배포 환경

저장소 루트의 `.clasp.json`은 `apps-script` 폴더만 Apps Script에 전송하도록 구성되어 있습니다. 현재 저장소에는 공개 웹앱의 배포 ID만 있고 Apps Script **Script ID**는 없으므로, 최초 1회 아래 절차로 기존 프로젝트의 Script ID를 입력해야 합니다. 웹앱 URL의 `/s/` 뒤 값은 배포 ID이며 Script ID 대신 사용할 수 없습니다.

### 최초 로그인과 기존 프로젝트 연결

1. [Apps Script 사용자 설정](https://script.google.com/home/usersettings)에서 **Google Apps Script API**를 사용 설정합니다.
2. PowerShell에서 clasp를 설치하고 로그인합니다.

   ```powershell
   npm.cmd install --global @google/clasp
   clasp.cmd login
   ```

3. 기존 Apps Script 편집기에서 **프로젝트 설정 → ID → 스크립트 ID**를 복사합니다.
4. 저장소 루트의 `.clasp.json`에서 `PASTE_EXISTING_APPS_SCRIPT_SCRIPT_ID_HERE`만 복사한 Script ID로 바꿉니다. `rootDir`는 `apps-script`로 유지합니다.
5. 최초 push 전에 Apps Script 편집기의 현재 `Code.gs`와 `appsscript.json`을 별도로 백업하고, 로컬 `apps-script/Code.gs`가 의도한 최신본인지 비교합니다. `clasp pull`은 로컬 파일을 덮어쓸 수 있으므로 이 저장소 루트에서 백업 없이 실행하지 않습니다.
6. 전송 대상을 확인합니다. `Code.gs`와 `appsscript.json`만 표시되어야 합니다.

   ```powershell
   clasp.cmd show-file-status
   ```

OAuth 토큰은 기본적으로 사용자 홈의 `.clasprc.json`에 저장됩니다. 저장소의 `.gitignore`도 `.clasprc.json`과 변형 파일을 제외하므로 인증정보를 Git에 추가하지 마세요. `.clasp.json`의 Script ID는 프로젝트 연결 정보이며 관리자 비밀번호, Webhook URL 같은 비밀값을 넣지 않습니다.

### 코드 push와 기존 웹앱 배포 업데이트

1. 로컬 코드를 기존 Apps Script 프로젝트에 전송합니다. 원격 코드 전체가 로컬 전송 대상으로 교체되므로 `show-file-status` 확인 후 실행합니다.

   ```powershell
   clasp.cmd push
   ```

2. 배포 목록에서 현재 웹앱 배포 ID가 아래 기존 ID와 일치하는지 확인합니다.

   ```powershell
   clasp.cmd list-deployments
   ```

   기존 배포 ID: `AKfycbxb_Ed3RuWJ0Coh_JKBHaPWZxZvJUUY1JqC4XOYnAv6WWyX1oFs3EawJ-m6aEaew_FVvA`

3. 새 버전을 만들고 출력된 버전 번호를 기록합니다.

   ```powershell
   clasp.cmd create-version "상담 예약 시스템 업데이트"
   ```

4. 새 배포를 만들지 말고 기존 배포 ID를 새 버전으로 업데이트합니다.

   ```powershell
   clasp.cmd update-deployment AKfycbxb_Ed3RuWJ0Coh_JKBHaPWZxZvJUUY1JqC4XOYnAv6WWyX1oFs3EawJ-m6aEaew_FVvA -V <버전번호> -d "상담 예약 시스템 업데이트"
   ```

5. `script.js`와 `admin.js`의 기존 웹앱 URL이 그대로인지 확인하고 학생 조회·예약·취소와 관리자 로그인을 실제 환경에서 점검합니다.

clasp 2.x를 사용하는 환경에서는 `create-version` 대신 `version`, `update-deployment` 대신 `redeploy <배포ID> <버전번호> <설명>` 명령을 사용합니다. 설치된 버전은 `clasp.cmd --version`과 `clasp.cmd --help`로 확인하세요. 이 저장소에는 GitHub Actions 자동 배포를 구성하지 않습니다.

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

## TODO: 비공개 의견함

- **목적:** 학생이 사이트 사용 중 불편한 점, 오류, 추가되면 좋겠는 기능을 제출할 수 있게 합니다.
- 학생 화면에서는 **익명 의견함**이 아닌 **비공개 의견함**으로 안내합니다. 의견은 다른 학생에게 공개되지 않습니다.
- 장난성 내용 방지를 위해 교사는 필요한 경우 작성자를 확인할 수 있음을 학생에게 명확히 안내합니다.
- 구현 시 필요한 작업:
  1. 학생 화면 의견 작성 모달
  2. Google Sheets `의견함` 시트 생성
  3. Apps Script `submitFeedback` action 추가
  4. 관리자 의견함 탭 추가
  5. 작성자 확인 시 관리자 비밀번호 재입력
  6. 상태 변경, 관리자 메모, 삭제 기능
  7. Apps Script 배포
- 구현 전에는 예약 비밀번호·상담 내용 등 민감정보를 받거나 저장하지 않도록 별도 검토합니다.

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
