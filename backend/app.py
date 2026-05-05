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
    rightHandDetected: bool
    rightHandX: float
    rightHandY: float
    # legacy single-hand fields kept for backward compat
    handDetected: bool
    openHand: bool
    confidence: float
    x: float
    y: float
    message: str


app = FastAPI(title='Hand Book Demo API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)

latest_state = HandState(
    connected=False,
    faceDetected=False,
    faceCount=0,
    faceCx=0.5,
    faceCy=0.3,
    faceForeheadY=0.15,
    leftHandDetected=False,
    leftHandX=0.3,
    leftHandY=0.7,
    rightHandDetected=False,
    rightHandX=0.7,
    rightHandY=0.7,
    handDetected=False,
    openHand=False,
    confidence=0.0,
    x=0.5,
    y=0.6,
    message='waiting for webcam',
)
state_lock = threading.Lock()
clients: set[asyncio.Queue[dict[str, Any]]] = set()
loop_ref: asyncio.AbstractEventLoop | None = None
stop_event = threading.Event()


def _finger_is_extended(landmarks: list[Any], tip: int, pip: int) -> bool:
    return landmarks[tip].y < landmarks[pip].y


def _thumb_is_extended(landmarks: list[Any]) -> bool:
    return abs(landmarks[4].x - landmarks[2].x) > 0.06


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
        min_detection_confidence=0.6,
        min_tracking_confidence=0.6,
    )
    cap: cv2.VideoCapture | None = None
    active_camera_index: int | None = None
    active_backend = os.environ.get('CAMERA_BACKEND', 'avfoundation').lower()

    while not stop_event.is_set():
        if cap is None or not cap.isOpened():
            cap, active_camera_index, active_backend = _create_camera()
            if not cap.isOpened():
                camera_label = 'forced index' if os.environ.get('CAMERA_INDEX') else 'indices 0-5'
                selected_index = 'unknown' if active_camera_index is None else str(active_camera_index)
                with state_lock:
                    latest_state = HandState(
                        connected=False,
                        faceDetected=False,
                        faceCount=0,
                        faceCx=0.5, faceCy=0.3, faceForeheadY=0.15,
                        leftHandDetected=False, leftHandX=0.3, leftHandY=0.7,
                        rightHandDetected=False, rightHandX=0.7, rightHandY=0.7,
                        handDetected=False, openHand=False, confidence=0.0,
                        x=0.5, y=0.6,
                        message=f'camera not available. tried {camera_label} ({active_backend}, idx={selected_index})',
                    )
                _broadcast_state(_to_payload(latest_state))
                time.sleep(1.0)
                continue

            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            with state_lock:
                latest_state = HandState(
                    connected=True,
                    faceDetected=False, faceCount=0,
                    faceCx=0.5, faceCy=0.3, faceForeheadY=0.15,
                    leftHandDetected=False, leftHandX=0.3, leftHandY=0.7,
                    rightHandDetected=False, rightHandX=0.7, rightHandY=0.7,
                    handDetected=False, openHand=False, confidence=0.0,
                    x=0.5, y=0.6,
                    message=f'camera ready on index {active_camera_index} using {active_backend}',
                )
            _broadcast_state(_to_payload(latest_state))

        ok, frame = cap.read()
        if not ok:
            with state_lock:
                latest_state = HandState(
                    connected=False,
                    faceDetected=False, faceCount=0,
                    faceCx=0.5, faceCy=0.3, faceForeheadY=0.15,
                    leftHandDetected=False, leftHandX=0.3, leftHandY=0.7,
                    rightHandDetected=False, rightHandX=0.7, rightHandY=0.7,
                    handDetected=False, openHand=False, confidence=0.0,
                    x=0.5, y=0.6,
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

        # Face coords (normalized)
        face_detected = bool(len(faces))
        face_cx = 0.5
        face_cy = 0.3
        face_forehead_y = 0.12

        if face_detected:
            fx, fy, fw, fh = faces[0]
            face_cx = (fx + fw * 0.5) / w_px
            face_cy = (fy + fh * 0.5) / h_px
            # Forehead: top of face rect minus 15% of face height
            face_forehead_y = max(0.0, (fy - fh * 0.15) / h_px)

        # Per-hand tracking — classify by x position (left side = leftHand)
        detected_hands: list[dict[str, Any]] = []

        if result.multi_hand_landmarks:
            for hand_lm in result.multi_hand_landmarks:
                landmarks = hand_lm.landmark
                xs = [p.x for p in landmarks]
                ys = [p.y for p in landmarks]
                cx = sum(xs) / len(xs)
                cy = sum(ys) / len(ys)

                extended = [
                    _finger_is_extended(landmarks, 8, 6),
                    _finger_is_extended(landmarks, 12, 10),
                    _finger_is_extended(landmarks, 16, 14),
                    _finger_is_extended(landmarks, 20, 18),
                    _thumb_is_extended(landmarks),
                ]
                open_count = sum(1 for e in extended if e)
                detected_hands.append({
                    'x': cx, 'y': cy,
                    'openHand': open_count >= 4,
                    'confidence': min(1.0, 0.45 + open_count * 0.11),
                })

        # Assign left/right by x position
        left_hand: dict[str, Any] | None = None
        right_hand: dict[str, Any] | None = None

        if len(detected_hands) == 1:
            h = detected_hands[0]
            if h['x'] < 0.5:
                left_hand = h
            else:
                right_hand = h
        elif len(detected_hands) >= 2:
            sorted_hands = sorted(detected_hands, key=lambda h: h['x'])
            left_hand = sorted_hands[0]
            right_hand = sorted_hands[-1]

        # Legacy single-hand fields (use whichever hand is more "active")
        primary = left_hand or right_hand
        hand_detected = primary is not None
        open_hand = primary['openHand'] if primary else False
        confidence = primary['confidence'] if primary else 0.0
        hx = primary['x'] if primary else 0.5
        hy = primary['y'] if primary else 0.6

        state = HandState(
            connected=True,
            faceDetected=face_detected,
            faceCount=int(len(faces)),
            faceCx=face_cx,
            faceCy=face_cy,
            faceForeheadY=face_forehead_y,
            leftHandDetected=left_hand is not None,
            leftHandX=left_hand['x'] if left_hand else 0.3,
            leftHandY=left_hand['y'] if left_hand else 0.7,
            rightHandDetected=right_hand is not None,
            rightHandX=right_hand['x'] if right_hand else 0.7,
            rightHandY=right_hand['y'] if right_hand else 0.7,
            handDetected=hand_detected,
            openHand=open_hand,
            confidence=confidence,
            x=hx, y=hy,
            message='tracking' if hand_detected else 'show both hands near the bottom of the frame',
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
