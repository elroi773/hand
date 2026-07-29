from __future__ import annotations

import asyncio
import os
import threading
import time
from dataclasses import asdict, dataclass
from typing import Any

import cv2
import mediapipe as mp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware


@dataclass
class HandState:
    connected: bool
    faceDetected: bool
    faceCount: int
    faceCx: float
    faceCy: float
    faceForeheadY: float
    leftHandDetected: bool
    leftHandX: float
    leftHandY: float
    leftPalmCenterX: float
    leftPalmCenterY: float
    leftPalmOpenScore: float
    leftWristX: float
    leftWristY: float
    rightHandDetected: bool
    rightHandX: float
    rightHandY: float
    rightPalmCenterX: float
    rightPalmCenterY: float
    rightPalmOpenScore: float
    rightWristX: float
    rightWristY: float
    # legacy single-hand fields
    handDetected: bool
    openHand: bool
    confidence: float
    x: float
    y: float
    message: str


@dataclass
class DetectedHand:
    x: float
    y: float
    wrist_x: float
    wrist_y: float
    palm_cx: float
    palm_cy: float
    open_hand: bool
    confidence: float
    palm_open_score: float


app = FastAPI(title='Hand Book Demo API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


def _make_state(**overrides: Any) -> HandState:
    values = {
        'connected': False,
        'faceDetected': False,
        'faceCount': 0,
        'faceCx': 0.5,
        'faceCy': 0.3,
        'faceForeheadY': 0.15,
        'leftHandDetected': False,
        'leftHandX': 0.3,
        'leftHandY': 0.7,
        'leftPalmCenterX': 0.3,
        'leftPalmCenterY': 0.7,
        'leftPalmOpenScore': 0.0,
        'leftWristX': 0.3,
        'leftWristY': 0.7,
        'rightHandDetected': False,
        'rightHandX': 0.7,
        'rightHandY': 0.7,
        'rightPalmCenterX': 0.7,
        'rightPalmCenterY': 0.7,
        'rightPalmOpenScore': 0.0,
        'rightWristX': 0.7,
        'rightWristY': 0.7,
        'handDetected': False,
        'openHand': False,
        'confidence': 0.0,
        'x': 0.5,
        'y': 0.6,
        'message': 'waiting for webcam',
    }
    values.update(overrides)
    return HandState(**values)


latest_state = _make_state()
state_lock = threading.Lock()
clients: set[asyncio.Queue[dict[str, Any]]] = set()
loop_ref: asyncio.AbstractEventLoop | None = None
stop_event = threading.Event()


def _dist_sq(a: Any, b: Any) -> float:
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2


def _palm_open_score(landmarks: list[Any]) -> float:
    """Robust open score: finger tip farther from wrist than pip = extended.

    Works regardless of hand orientation (sideways, downward, etc.).
    """
    wrist = landmarks[0]

    # (tip_idx, pip_idx) for index/middle/ring/pinky
    pairs = [(8, 6), (12, 10), (16, 14), (20, 18)]
    ext_count = sum(
        1 for tip_i, pip_i in pairs
        if _dist_sq(landmarks[tip_i], wrist) > _dist_sq(landmarks[pip_i], wrist)
    )

    # Thumb: tip farther from index-MCP than thumb-ip
    if _dist_sq(landmarks[4], landmarks[5]) > _dist_sq(landmarks[3], landmarks[5]):
        ext_count += 1

    ext_score = ext_count / 5.0

    # MCP knuckle spread
    mcp_xs = [landmarks[5].x, landmarks[9].x, landmarks[13].x, landmarks[17].x]
    mcp_spread = max(mcp_xs) - min(mcp_xs)
    spread_score = min(1.0, mcp_spread / 0.10)

    return round(ext_score * 0.6 + spread_score * 0.4, 3)


def _palm_center(landmarks: list[Any]) -> tuple[float, float]:
    """Stable palm center: wrist + 4 MCP joints."""
    idx = [0, 5, 9, 13, 17]
    x = round(sum(landmarks[i].x for i in idx) / len(idx), 4)
    y = round(sum(landmarks[i].y for i in idx) / len(idx), 4)
    return x, y


def _detect_hands(result: Any) -> list[DetectedHand]:
    if not result.multi_hand_landmarks:
        return []

    detected_hands: list[DetectedHand] = []
    for hand_lm in result.multi_hand_landmarks:
        landmarks = hand_lm.landmark
        xs = [p.x for p in landmarks]
        ys = [p.y for p in landmarks]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)

        palm_score = _palm_open_score(landmarks)
        palm_cx, palm_cy = _palm_center(landmarks)
        detected_hands.append(DetectedHand(
            x=cx,
            y=cy,
            wrist_x=landmarks[0].x,
            wrist_y=landmarks[0].y,
            palm_cx=palm_cx,
            palm_cy=palm_cy,
            open_hand=palm_score >= 0.5,
            confidence=min(1.0, 0.55 + palm_score * 0.45),
            palm_open_score=palm_score,
        ))

    return detected_hands


def _split_screen_hands(
    detected_hands: list[DetectedHand],
) -> tuple[DetectedHand | None, DetectedHand | None]:
    if len(detected_hands) == 1:
        hand = detected_hands[0]
        return (hand, None) if hand.x < 0.5 else (None, hand)

    if len(detected_hands) >= 2:
        sorted_hands = sorted(detected_hands, key=lambda hand: hand.x)
        return sorted_hands[0], sorted_hands[-1]

    return None, None


def _log_detection(
    detected_hands: list[DetectedHand],
    left_hand: DetectedHand | None,
    right_hand: DetectedHand | None,
    face_detected: bool,
    brightness: float,
    camera_index: int | None,
) -> None:
    print(
        f'[vision] hands={len(detected_hands)} face={face_detected}'
        f' brightness={brightness:.0f} cam={camera_index}',
        flush=True,
    )
    if left_hand:
        print(
            f'[vision] left=({left_hand.x:.2f},{left_hand.y:.2f})'
            f' palmCtr=({left_hand.palm_cx:.2f},{left_hand.palm_cy:.2f})'
            f' open={left_hand.palm_open_score:.2f}',
            flush=True,
        )
    if right_hand:
        print(
            f'[vision] right=({right_hand.x:.2f},{right_hand.y:.2f})'
            f' palmCtr=({right_hand.palm_cx:.2f},{right_hand.palm_cy:.2f})'
            f' open={right_hand.palm_open_score:.2f}',
            flush=True,
        )
    if not detected_hands:
        print('[vision] no hands detected', flush=True)


def _state_from_detection(
    face_detected: bool,
    face_count: int,
    face_cx: float,
    face_cy: float,
    face_forehead_y: float,
    left_hand: DetectedHand | None,
    right_hand: DetectedHand | None,
) -> HandState:
    primary = left_hand or right_hand
    hand_detected = primary is not None

    return _make_state(
        connected=True,
        faceDetected=face_detected,
        faceCount=face_count,
        faceCx=face_cx,
        faceCy=face_cy,
        faceForeheadY=face_forehead_y,
        leftHandDetected=left_hand is not None,
        leftHandX=left_hand.x if left_hand else 0.3,
        leftHandY=left_hand.y if left_hand else 0.7,
        leftPalmCenterX=left_hand.palm_cx if left_hand else 0.3,
        leftPalmCenterY=left_hand.palm_cy if left_hand else 0.7,
        leftPalmOpenScore=left_hand.palm_open_score if left_hand else 0.0,
        leftWristX=left_hand.wrist_x if left_hand else 0.3,
        leftWristY=left_hand.wrist_y if left_hand else 0.7,
        rightHandDetected=right_hand is not None,
        rightHandX=right_hand.x if right_hand else 0.7,
        rightHandY=right_hand.y if right_hand else 0.7,
        rightPalmCenterX=right_hand.palm_cx if right_hand else 0.7,
        rightPalmCenterY=right_hand.palm_cy if right_hand else 0.7,
        rightPalmOpenScore=right_hand.palm_open_score if right_hand else 0.0,
        rightWristX=right_hand.wrist_x if right_hand else 0.7,
        rightWristY=right_hand.wrist_y if right_hand else 0.7,
        handDetected=hand_detected,
        openHand=primary.open_hand if primary else False,
        confidence=primary.confidence if primary else 0.0,
        x=primary.x if primary else 0.5,
        y=primary.y if primary else 0.6,
        message='tracking' if hand_detected else 'show both hands near the bottom of the frame',
    )


def _to_payload(state: HandState) -> dict[str, Any]:
    return asdict(state)


def _broadcast_state(payload: dict[str, Any]) -> None:
    if loop_ref is None:
        return

    def _enqueue(queue: asyncio.Queue[dict[str, Any]], item: dict[str, Any]) -> None:
        try:
            while queue.full():
                queue.get_nowait()
            queue.put_nowait(item)
        except asyncio.QueueEmpty:
            queue.put_nowait(item)

    for queue in list(clients):
        try:
            loop_ref.call_soon_threadsafe(_enqueue, queue, payload)
        except RuntimeError:
            continue


def _create_camera() -> tuple[cv2.VideoCapture, int | None, str]:
    backend_name = os.environ.get('CAMERA_BACKEND', 'avfoundation').lower()
    backend_map = {
        'any': cv2.CAP_ANY,
        'avfoundation': getattr(cv2, 'CAP_AVFOUNDATION', cv2.CAP_ANY),
        'mjpeg': getattr(cv2, 'CAP_MJPEG', cv2.CAP_ANY),
    }
    backend = backend_map.get(backend_name, backend_map['avfoundation'])

    camera_indexes: list[int]
    forced_index = os.environ.get('CAMERA_INDEX')
    if forced_index is not None and forced_index != '':
        camera_indexes = [int(forced_index)]
    else:
        camera_indexes = list(range(0, 6))

    for camera_index in camera_indexes:
        capture = cv2.VideoCapture(camera_index, backend) if backend != cv2.CAP_ANY else cv2.VideoCapture(camera_index)
        if capture.isOpened():
            return capture, camera_index, backend_name
        capture.release()

    fallback_capture = cv2.VideoCapture(0, backend) if backend != cv2.CAP_ANY else cv2.VideoCapture(0)
    return fallback_capture, None, backend_name


def _capture_loop() -> None:
    global latest_state

    face_detector = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    hands_detector = mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        model_complexity=1,
        min_detection_confidence=0.45,
        min_tracking_confidence=0.45,
    )
    cap: cv2.VideoCapture | None = None
    active_camera_index: int | None = None
    active_backend = os.environ.get('CAMERA_BACKEND', 'avfoundation').lower()
    last_log_time: float = 0.0

    while not stop_event.is_set():
        if cap is None or not cap.isOpened():
            cap, active_camera_index, active_backend = _create_camera()
            if not cap.isOpened():
                camera_label = 'forced index' if os.environ.get('CAMERA_INDEX') else 'indices 0-5'
                selected_index = 'unknown' if active_camera_index is None else str(active_camera_index)
                with state_lock:
                    latest_state = _make_state(
                        connected=False,
                        message=f'camera not available. tried {camera_label} ({active_backend}, idx={selected_index})',
                    )
                _broadcast_state(_to_payload(latest_state))
                time.sleep(1.0)
                continue

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            with state_lock:
                latest_state = _make_state(
                    connected=True,
                    message=f'camera ready on index {active_camera_index} using {active_backend}',
                )
            _broadcast_state(_to_payload(latest_state))

        ok, frame = cap.read()
        if not ok:
            with state_lock:
                latest_state = _make_state(
                    connected=False,
                    message='camera frame unavailable. retrying',
                )
            _broadcast_state(_to_payload(latest_state))
            if cap is not None:
                cap.release()
                cap = None
                active_camera_index = None
            time.sleep(0.05)
            continue

        frame = cv2.flip(frame, 1)
        h_px, w_px = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = hands_detector.process(rgb)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        faces = face_detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))

        face_detected = bool(len(faces))
        face_cx = 0.5
        face_cy = 0.3
        face_forehead_y = 0.12

        if face_detected:
            fx, fy, fw, fh = faces[0]
            face_cx = (fx + fw * 0.5) / w_px
            face_cy = (fy + fh * 0.5) / h_px
            face_forehead_y = max(0.0, (fy - fh * 0.15) / h_px)

        detected_hands = _detect_hands(result)
        left_hand, right_hand = _split_screen_hands(detected_hands)

        # ── 1-second diagnostic log ───────────────────────────────────────────
        now_t = time.monotonic()
        if now_t - last_log_time >= 1.0:
            last_log_time = now_t
            _log_detection(
                detected_hands=detected_hands,
                left_hand=left_hand,
                right_hand=right_hand,
                face_detected=face_detected,
                brightness=gray.mean(),
                camera_index=active_camera_index,
            )

        state = _state_from_detection(
            face_detected=face_detected,
            face_count=int(len(faces)),
            face_cx=face_cx,
            face_cy=face_cy,
            face_forehead_y=face_forehead_y,
            left_hand=left_hand,
            right_hand=right_hand,
        )

        with state_lock:
            latest_state = state

        _broadcast_state(_to_payload(state))
        time.sleep(1 / 30)

    if cap is not None:
        cap.release()


@app.on_event('startup')
async def startup_event() -> None:
    global loop_ref
    loop_ref = asyncio.get_running_loop()
    threading.Thread(target=_capture_loop, daemon=True).start()


@app.on_event('shutdown')
async def shutdown_event() -> None:
    stop_event.set()


@app.get('/health')
async def health() -> dict[str, Any]:
    with state_lock:
        return _to_payload(latest_state)


@app.websocket('/ws')
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1)
    clients.add(queue)

    try:
        with state_lock:
            await websocket.send_json(_to_payload(latest_state))

        while True:
            payload = await queue.get()
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        return
    finally:
        clients.discard(queue)
