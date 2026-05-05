/**
 * Convert normalized landmark coords (0–1, in backend-flipped space) to
 * screen pixel position, accounting for object-fit: cover scaling.
 *
 * The video element has transform: scaleX(-1) applied via CSS, which mirrors
 * the display to match the backend's cv2.flip(frame, 1) coordinate space.
 * These functions produce pixel coords in that same space — so overlay
 * elements placed at (screenX, screenY) land on top of the correct landmark.
 *
 * macOS camera-sharing note:
 *   Both the browser (getUserMedia) and Python (cv2.VideoCapture) open the
 *   same physical camera device simultaneously. On macOS 13+ this is generally
 *   allowed, but some older AVFoundation versions may serialize access and
 *   introduce 1–2 frame latency on one consumer. If landmarks appear shifted,
 *   try setting CAMERA_INDEX=0 in the backend env to force the same device.
 */

export function normToScreen(
  normX: number,
  normY: number,
  videoW: number,
  videoH: number,
  winW: number,
  winH: number,
): [number, number] {
  const scale = Math.max(winW / videoW, winH / videoH)
  const ox = (winW - videoW * scale) / 2
  const oy = (winH - videoH * scale) / 2
  return [normX * videoW * scale + ox, normY * videoH * scale + oy]
}

/** Convert screen pixel position to Three.js orthographic world coords
 *  (camera: left=-W/2, right=W/2, top=H/2, bottom=-H/2). */
export function screenToThree(
  sx: number,
  sy: number,
  winW: number,
  winH: number,
): [number, number] {
  return [sx - winW / 2, -(sy - winH / 2)]
}

export function normToThree(
  normX: number,
  normY: number,
  videoW: number,
  videoH: number,
  winW: number,
  winH: number,
): [number, number] {
  const [sx, sy] = normToScreen(normX, normY, videoW, videoH, winW, winH)
  return screenToThree(sx, sy, winW, winH)
}
