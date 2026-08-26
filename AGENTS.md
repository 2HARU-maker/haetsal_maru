# 햇살마루 작업 원칙

이 저장소는 햇살마루 운영 서비스와 완전히 분리된 **Firebase Emulator 전용 검증 환경**이다. 모든 작업은 운영 데이터 보호와 기존 동작 보존을 최우선으로 한다.

## 적용 범위와 우선순위

- 이 지침은 저장소 전체에 적용한다.
- 사용자가 요청한 범위만 작업하고, 관련이 있어 보여도 승인받지 않은 수정은 하지 않는다.
- 기존 파일과 사용자 변경사항을 보존한다. 요청과 무관한 정리, 리팩터링, 이름 변경, 포맷 변경은 하지 않는다.
- 문제를 발견해도 요청 범위 밖이면 수정하지 말고 `발견했지만 이번 수정 범위에는 포함하지 않겠습니다.`라고 보고한다.

## 운영 환경 보호

- 운영 Firebase 프로젝트 `haetsal-maru-24b95`에는 읽기, 쓰기, 배포를 포함한 어떤 접근도 하지 않는다.
- `firebase deploy`, Firestore Rules 배포, Hosting 배포 등 운영 상태를 바꿀 수 있는 명령은 실행하지 않는다.
- 운영 index, 운영 Firestore 데이터, 운영 Rules를 수정하거나 Emulator 파일로 덮어쓰지 않는다.
- 백필, 마이그레이션, 실제 계정 생성·연결은 별도 분석과 명시적 승인 없이는 수행하지 않는다.
- 이 저장소의 결과물을 GitHub Pages나 운영 Hosting에 배포하지 않는다.

## Emulator 안전 기준

- Firebase 프로젝트 ID는 반드시 `demo-haetsalmaru`만 사용한다.
- 연결 대상은 다음 로컬 주소로 한정한다.
  - Firestore Emulator: `127.0.0.1:8080`
  - Authentication Emulator: `127.0.0.1:9099`
  - Emulator UI: `127.0.0.1:4000`
  - 테스트 앱: `127.0.0.1:5500`
- 테스트 앱은 `localhost` 또는 `127.0.0.1`에서만 실행한다.
- seed 데이터에는 개인정보나 실제 계정을 넣지 않고, 준비된 가짜 사용자와 로컬 테스트 계정만 사용한다.
- 실행 또는 검증 전에 운영 projectId가 요청에 포함되지 않는지 확인한다.

## 변경 원칙

- 앱 기능, UI, CSS, 문구, Firestore 구조, Rules 내용, 쿠폰 계산, 주문 완료 로직은 해당 변경을 사용자가 명시적으로 요청한 경우에만 수정한다.
- 원인 분석이나 재현을 요청받은 경우에는 먼저 현재 코드를 그대로 검증한다. 실패를 숨기기 위한 임의 수정은 하지 않는다.
- `firestore.rules`는 운영 Rules의 검증용 사본으로 취급하며, 명시적 요청 없이 내용을 바꾸지 않는다.
- `index_emulator_only.html`은 Emulator 전용 사본이다. 운영 Firebase 설정이나 운영 projectId를 다시 넣지 않는다.
- 의존성은 `package.json`과 lockfile에 고정된 버전을 유지한다.
  - `firebase-tools`: `15.28.1`
  - `firebase-admin`: `14.3.0`
- 패키지를 임의로 업그레이드하거나 lockfile을 불필요하게 다시 생성하지 않는다.
- 백업 파일과 날짜가 붙은 운영 후보 파일은 사용자가 대상을 명시하지 않는 한 수정하지 않는다.

## 실행 및 검증

- 먼저 `README_FIRST.md`와 `CODEX_FIRST_RUN_INSTRUCTIONS.txt`를 읽고 현재 작업에 해당하는 지침을 확인한다.
- 정적 검증은 `npm run check`를 사용한다.
- 동적 검증이 필요한 경우 다음 순서를 지킨다.
  1. `npm run emulators`
  2. Emulator 기동 확인 후 `npm run seed`
  3. `npm run serve`
- Emulator가 실제로 `demo-haetsalmaru`로 실행되는지 확인한다.
- 네트워크 요청에서 운영 프로젝트 접근이 0건인지, Auth와 Firestore가 각각 로컬 Emulator로 연결되는지 확인한다.
- 주문 흐름 검증을 요청받으면 일반 음료 1장, 우유 사용 2장, 4샷 2장, 우유+4샷 3장 시나리오를 구분하여 기록한다.
- 주문 테스트에서는 live order, completion request/event, shared people auth, 관련 coupon event 문서 상태를 확인한다.

## 실패 처리와 보고

- 검증이 실패해도 사용자가 수정까지 요청하지 않았다면 코드를 변경하지 않는다.
- 실패 단계, 콘솔 오류, Emulator Requests/Rules 결과, 관련 문서 상태를 구체적으로 기록한다.
- 확인하지 못한 항목을 성공으로 추정하지 않고 `⚠️ 미검증`으로 표시한다.
- 결과는 가능한 한 다음 상태로 명확히 구분한다.
  - `✅ 검증 완료`
  - `⚠️ 미검증`
  - `❌ 실패`
- 최종 보고에는 작업 범위에 맞게 운영 index 변경 여부, `firestore.rules` 변경 여부, 운영 Firebase 접근 여부, Emulator 실제 연결 여부와 테스트별 결과를 포함한다.

