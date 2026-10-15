# Pomodoro

[웹앱 열기](https://sohyeon-kang.github.io/pomodoro/) · 로그인 없이 이용할 수 있습니다.

Apple Design Resources의 tvOS 18 UI Kit 미리보기를 참고한 간결한 PC 뽀모도로 웹앱입니다. 중립적인 회색 배경, 흰색 선택 상태, 둥근 사각형 컨트롤, 포커스 시 확대와 그림자를 적용했습니다. 메인 화면에는 타이머와 필수 컨트롤만 표시하고 시간 변경, 기록·할 일, 설정은 대화상자에서 엽니다. 외부 런타임 라이브러리 없이 HTML, CSS, JavaScript로 동작합니다.

## 실행

Node.js 20 이상에서 이 폴더를 열고 `npm start`를 실행한 다음 http://127.0.0.1:4173 에 접속합니다. 의존성 설치는 필요하지 않습니다. `dist/index.html`을 직접 여는 대신 HTTP 서버로 실행해야 ES 모듈을 불러올 수 있습니다.

## 기능

- 기본 집중 시간 25분. 숫자 입력, 슬라이더, 15/25/45/60분 프리셋으로 1~180분 설정.
- 집중/짧은 휴식/긴 휴식, 일시정지/재개/초기화. 기본 휴식은 5분/15분이며 각각 1~60분 설정.
- 4번 집중 완료 후 긴 휴식 권장. 선택적으로 휴식 자동 시작.
- 절대 종료 시각을 이용한 타이머. 백그라운드 탭의 호출 지연에 따른 오차를 보정하고 새로고침 후 상태를 복원.
- 완료한 집중 세션의 일별/최근 7일 기록, 하루 목표, CSV 내보내기.
- 할 일 추가/선택/완료/삭제. 세션 시작 시 선택한 할 일을 해당 기록에 저장.
- 완료 알림음, 밝은/어두운 테마, 전체 화면.
- Space: 시작/일시정지(입력·버튼 포커스 제외), Ctrl/Cmd + 쉼표: 설정, Escape: 대화상자 닫기, 방향키: 모드 탭 이동.

## 데이터와 동작

모든 개인 기록과 설정은 현재 브라우저의 localStorage(`moru-focus-v1`)에 저장됩니다. 서버로 전송하거나 계정 간 동기화하지 않습니다. 브라우저 데이터를 삭제하면 기록도 삭제되므로 필요하면 CSV로 보관하세요. **공부 기록은 완료한 집중 세션만 집계**하며 중간에 초기화한 세션은 기록하지 않습니다.

탭을 닫거나 PC가 절전 상태인 동안 알림음은 재생되지 않습니다. 다시 열면 저장된 종료 시각에 맞게 복원합니다. 기기 시각을 수동으로 크게 변경하면 시간 계산에 영향을 줄 수 있습니다. CSV 파일의 시각과 앱의 날짜는 실행하는 기기의 현지 시간대 기준입니다.

## 검증

`npm test` — 시간 계산, 일시정지, 복원, 중복 완료 방지, 입력 범위, 4회 주기를 검증합니다.

## GitHub Pages 배포

`main` 브랜치에 변경사항을 push하면 GitHub Actions가 테스트를 실행하고 `dist` 폴더를 GitHub Pages에 배포합니다. 저장소 Settings → Pages의 배포 소스는 GitHub Actions로 설정합니다. `.github/workflows/pages.yml`에서 수동 재배포도 실행할 수 있습니다.

웹앱과 소스는 공개되지만 개인 공부 기록은 서버나 저장소로 전송되지 않습니다. 다른 주소에서 사용하던 기록은 브라우저 저장소가 분리되어 자동으로 이전되지 않습니다.

## 구성

- `dist/index.html`, `dist/styles.css`: 한국어 UI 및 반응형 스타일
- `dist/app.js`: UI, 로컬 저장, 기록, 알림음
- `dist/timer.js`: DOM과 분리된 타이머 엔진
- `tests/timer.test.mjs`: 가짜 시계로 검증하는 엔진 테스트
- `server.mjs`: 로컬 미리보기 HTTP 서버

## 디자인 참고

- https://developer.apple.com/design/resources/
- https://developer.apple.com/design/human-interface-guidelines/

공식 tvOS 18 UI Kit 미리보기: https://developer.apple.com/design/resources/images/thumbnails/tvOS14-Sketch-Library-small_2x.png (현재 tvOS 18 섹션에서 연결한 파일입니다.)

폰트는 Apple의 웹 시스템 폰트 방식에 맞춰 `-apple-system, BlinkMacSystemFont, system-ui`를 우선합니다. Apple 기기에서는 SF 시스템 서체를 사용하고, Windows에서는 Segoe UI 등 시스템 대체 서체를 사용합니다. SF Pro 다운로드 라이선스의 임베딩·웹 콘텐츠 제한 때문에 폰트 파일은 번들링하거나 서버에서 배포하지 않습니다.

- 폰트·라이선스: https://developer.apple.com/fonts/
- 웹 시스템 폰트 안내: https://webkit.org/blog/3709/using-the-system-font-in-web-content/

아이콘은 일반적인 SVG로 직접 작성했습니다. 기존 사용자 데이터 호환을 위해 localStorage 키는 `moru-focus-v1`로 유지합니다.
