# 프로젝트 작업 규칙

이 프로젝트를 분석하거나 수정할 때는 항상 다음 규칙을 따른다.

---

# 작업 원칙

- 기존 기능을 임의로 삭제하거나 변경하지 않는다.
- 기존 기능을 깨뜨리지 않는 방향으로 기능을 추가한다.
- 요청과 관련 없는 파일은 수정하지 않는다.
- 리팩토링이나 코드 정리는 사용자가 요청한 경우에만 수행한다.
- 사용자가 요청한 범위만 최소한으로 수정한다.
- 수정 전에 어떤 파일을 왜 변경할지 간단히 설명한다.
- 수정 후 변경된 파일 목록과 변경 내용을 요약한다.
- HTML, CSS, JavaScript 구조를 가능한 한 단순하게 유지한다.
- 모바일과 PC 화면에서 모두 정상적으로 동작하는지 확인한다.
- 접근성(키보드 조작, 포커스 등)을 가능한 유지한다.
- 오류가 생길 가능성이 있으면 먼저 알리고 임의로 큰 구조 변경을 하지 않는다.
- 기존 API와 데이터 구조는 가능한 유지한다.
- 기존 사용자 데이터가 손실되는 변경은 하지 않는다.
- 작업 완료 후 실제 파일을 저장한다.

---

# 테스트

- 수정이 끝나면 관련 기능을 테스트한다.
- 문법 오류가 없는지 확인한다.
- Console 오류가 없는지 확인한다.
- 기존 기능이 정상 동작하는지 회귀 테스트를 수행한다.
- 모바일 화면에서도 정상적으로 동작하는지 확인한다.
- 테스트 실패 시 원인을 수정한다.
- 해결하지 못하면 Push하지 말고 사용자에게 원인을 보고한다.

---

# Git

- 작업을 시작하기 전에 origin/main과 동기화되어 있는지 확인한다.
- 작업이 성공적으로 완료되고 테스트를 통과하면 항상 자동으로 다음 순서를 수행한다.

1. git add .
2. git commit
3. git push origin main

- Commit 메시지는 변경 내용을 반영하여 한국어로 작성한다.
- Git 충돌이 발생하면 자동 병합하지 말고 사용자에게 보고한다.
- Push 실패나 인증 오류가 발생하면 사용자에게 원인을 보고한다.
- Push 완료 후 Commit 해시와 Push 결과를 사용자에게 알려준다.

---

# 배포 기준

작업 완료 후 반드시 변경된 파일 목록을 확인하고 아래 기준에 따라 배포한다.

## 1. `apps-script` 폴더가 변경된 경우

다음 파일 중 하나라도 변경된 경우에만 Apps Script 배포를 진행한다.

- `apps-script/Code.gs`
- `apps-script/appsscript.json`
- `apps-script` 폴더 내 기타 Apps Script 관련 파일

수행 순서:

1. Git commit
2. Git push
3. `clasp push`
4. 원격 Apps Script 코드와 로컬 코드 일치 확인
5. 새 Apps Script Version 생성
6. 기존 Deployment ID를 새 Version으로 업데이트
7. 기존 Web App URL 유지 확인
8. 배포 URL HTTP 200 확인

주의:

- 새 Apps Script 프로젝트를 만들지 않는다.
- 새 Deployment를 만들지 않는다.
- 기존 Script ID와 기존 Deployment ID만 사용한다.
- 기존 Web App URL을 변경하지 않는다.

## 2. GitHub Pages 정적 파일만 변경된 경우

다음 파일만 변경된 경우에는 Apps Script 배포를 하지 않는다.

- `index.html`
- `styles.css`
- `script.js`
- `admin.html`
- `admin.css`
- `admin.js`
- `README.md`
- 기타 GitHub Pages 정적 자산

단, `README.md`를 포함해 문서 파일만 변경된 경우에는 아래 3번 문서 전용 기준을 우선 적용한다.

수행 순서:

1. Git commit
2. Git push
3. GitHub Pages 배포 상태 확인
4. 실제 학생 페이지와 관리자 페이지 HTTP 200 확인

이 경우 아래 작업은 절대 하지 않는다.

- `clasp push`
- Apps Script 새 Version 생성
- Apps Script Deployment 업데이트

## 3. `README.md` 또는 문서만 변경된 경우

문서만 변경된 경우에는 다음만 수행한다.

1. Git commit
2. Git push

- Apps Script 배포와 GitHub Pages 동작 테스트는 필요한 경우에만 수행한다.

## 4. 최종 보고 규칙

최종 보고에는 반드시 아래 내용을 포함한다.

- 변경된 파일 목록
- `apps-script` 폴더 변경 여부
- 실제 수행한 배포 방식
  - GitHub Pages만 배포
  - Apps Script까지 배포
  - 문서만 push
- Apps Script Version 생성 여부
- Apps Script Deployment 업데이트 여부
- 기존 Deployment ID와 Web App URL 유지 여부
- Git commit hash
- 테스트 결과

## 5. 불필요한 배포 금지

- `apps-script` 폴더가 변경되지 않았다면 `clasp push`, 새 Apps Script Version 생성, 기존 Deployment 업데이트를 수행하지 않는다.
- 정적 화면 수정만으로 Apps Script 새 Version을 만들지 않는다.

---

# Google Apps Script

- Apps Script 배포 여부와 순서는 위의 배포 기준을 따른다.
- 기존 Web App URL은 변경하지 않는다.
- 기존 Google Sheets 구조를 임의로 변경하지 않는다.
- 새로운 시트나 열이 필요한 경우 먼저 사용자에게 알려준다.

---

# GitHub Pages

- GitHub Pages 정적 파일이 변경된 경우 Push 후 Pages 배포가 완료되는지 확인한다.
- 문서만 변경된 경우 GitHub Pages 동작 테스트는 필요한 경우에만 수행한다.
- GitHub Pages 구조를 임의로 변경하지 않는다.
- 사용자가 별도의 Git 작업을 하지 않아도 되도록 자동 Commit 및 Push를 기본으로 한다.

---

# UI/UX

- 기존 디자인을 최대한 유지한다.
- 버튼처럼 보이지 않아야 하는 요소는 버튼 스타일을 적용하지 않는다.
- 사용자가 요청하지 않은 디자인 변경은 하지 않는다.
- 모바일에서도 레이아웃이 깨지지 않도록 한다.

---

# 보안

- 관리자 비밀번호를 프론트엔드 코드에 하드코딩하지 않는다.
- 민감한 정보는 서버에서만 검증한다.
- 학생 비밀번호나 개인정보를 브라우저에 노출하지 않는다.
- 관리자 기능은 항상 서버 인증을 거친다.

---

# 응답 형식

작업이 끝나면 항상 아래 내용을 보고한다.

## 수정한 파일

- 수정한 파일 목록

## 변경 내용

- 무엇을 변경했는지

## 테스트 결과

- 어떤 테스트를 수행했고 결과가 어땠는지

## Git

- Commit 메시지
- Commit 해시
- Push 결과

## 추가 작업 여부

- `apps-script` 폴더 변경 여부
- 실제 수행한 배포 방식
- Apps Script Version 생성 및 Deployment 업데이트 여부
- 기존 Deployment ID와 Web App URL 유지 여부
- Google Sheets 수정이 필요한지
- 사용자가 직접 해야 하는 작업이 있는지

---

# 금지 사항

- 사용자가 요청하지 않은 리팩토링 금지
- 기존 기능 삭제 금지
- 기존 데이터 삭제 금지
- 임의의 라이브러리 추가 금지
- 테스트 실패 상태에서 Push 금지
- 강제 Push(force push) 금지
- Web App URL 변경 금지
- Git 충돌을 임의로 해결하지 말 것
