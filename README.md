
실시간 웹캠 화면 위에 Three.js 오버레이를 합성하여, 사용자의 얼굴과 손 동작을 인식하고 **“지식이 머릿속으로 들어가는 듯한”** 인터랙션을 구현한 AR 스타일 웹 데모입니다.

사용자가 양손을 책을 펼치듯 좌우로 벌리면, 손 사이에서 문자 입자가 생성되고 얼굴의 이마 방향으로 이동하며 흡수되는 애니메이션이 재생됩니다.

---

## 프로젝트 개요

이 프로젝트는 단순히 3D 책 오브젝트를 보여주는 데모가 아니라, 사용자의 실제 카메라 화면을 기반으로 동작하는 인터랙티브 AR 데모입니다.

기존 대시보드형 UI를 제거하고, 화면 전체를 웹캠 화면으로 구성했습니다. Three.js는 별도의 패널이 아닌 웹캠 영상 위에 투명 캔버스 오버레이로 합성됩니다.

---

## 주요 기능

- 실시간 웹캠 화면 전체화면 출력
- Python/OpenCV 기반 얼굴 및 손 인식
- 양손 위치 추적
- 얼굴 중심 및 이마 위치 계산
- 양손을 좌우로 벌리는 **“책 펼침”** 제스처 감지
- Three.js 기반 문자 입자 애니메이션
- 손 사이에서 생성된 지식 입자가 얼굴 방향으로 이동
- 이마 근처에서 입자가 작아지고 투명해지며 사라지는 흡수 효과
- 전체화면 몰입형 AR 스타일 UI
- 개발 확인용 디버그 모드 지원

---

## 기술 스택

### Frontend

- React
- TypeScript
- Vite
- Three.js
- CSS

### Backend

- Python
- OpenCV
- MediaPipe 또는 OpenCV 기반 Vision Processing
- FastAPI / Flask 계열 백엔드 구조

---

## 프로젝트 구조

```txt
hand/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   └── __init__.py
│
├── public/
│   └── favicon.svg
│
├── scripts/
│   └── dev-all.mjs
│
├── src/
│   ├── components/
│   │   ├── CameraVideo.tsx
│   │   ├── ThreeOverlay.tsx
│   │   └── BookScene.tsx
│   │
│   ├── hooks/
│   │   ├── useHandStream.ts
│   │   └── useVisionTracking.ts
│   │
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── vite-env.d.ts
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
