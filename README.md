# Hand Book Demo

손을 펼치면 책이 생기고, 머리 쪽으로 지식이 올라가는 작은 인터랙티브 웹 데모입니다.

## 구성

- 프런트엔드: Vite + React + TypeScript + three.js
- 백엔드: Python + OpenCV + MediaPipe + FastAPI WebSocket

## 실행 방법

### 처음 준비

```bash
npm install
python3 -m pip install -r backend/requirements.txt
```

### 한번에 실행

```bash
npm run dev:all
```

프런트엔드는 `http://localhost:5173`, Python 백엔드는 `http://localhost:8000`에서 실행됩니다.

### 따로 실행

```bash
npm run backend:dev
```

다른 터미널:

```bash
npm run dev
```

Python 패키지만 다시 설치해야 한다면:

```bash
python3 -m pip install -r backend/requirements.txt
```

## 동작 방식

- 백엔드가 로컬 카메라를 읽고 손을 추적합니다.
- 손바닥이 펼쳐지면 `openHand` 상태가 `true`가 됩니다.
- 프런트엔드는 Vite proxy를 통해 `/health`, `/ws`로 백엔드에 연결합니다.
- WebSocket으로 상태를 받아 three.js 장면의 책, 빛, 지식 입자를 움직입니다.

## 메모

- macOS에서는 Python/Terminal에 카메라 권한이 필요합니다. 시스템 설정에서 VS Code 또는 실행한 터미널 앱에 카메라 접근을 허용하세요.
- 백엔드는 기본적으로 카메라 인덱스 0부터 5까지 자동으로 시도합니다.
- 특정 장치가 필요하면 `CAMERA_INDEX=1 npm run backend:dev` 처럼 지정할 수 있습니다.
- 손이 화면에 제대로 들어오지 않으면 상태가 대기 상태로 유지됩니다.
