// Landmark indices
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;
const WRIST = 0;

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isFingerExtended(landmarks, tipIdx, pipIdx) {
  return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.02;
}

export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'none';

  const indexExt = isFingerExtended(landmarks, INDEX_TIP, INDEX_PIP);
  const middleExt = isFingerExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP);
  const ringExt = isFingerExtended(landmarks, RING_TIP, RING_PIP);
  const pinkyExt = isFingerExtended(landmarks, PINKY_TIP, PINKY_PIP);

  // Pinch: thumb tip close to index tip, other fingers relaxed
  const pinchDist = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  if (pinchDist < 0.06) {
    return 'pinch';
  }

  const extCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  // Fist: 0-1 fingers extended and index not extended
  if (extCount <= 1 && !indexExt) {
    return 'fist';
  }

  // Point: index extended, others curled
  if (indexExt && !middleExt && !ringExt) {
    return 'point';
  }

  // Victory/Peace (2 fingers): index + middle extended, ring + pinky curled → rotate
  if (indexExt && middleExt && !ringExt && !pinkyExt) {
    return 'rotate';
  }

  // Open hand: 3+ fingers extended
  if (extCount >= 3) {
    return 'open';
  }

  return 'none';
}

export function getCursorPosition(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  return { x: 1 - landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
}

export function getHandCenter(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  return { x: 1 - landmarks[WRIST].x, y: landmarks[WRIST].y };
}

export function getPinchDistance(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;
  return dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
}

// Compute hand roll angle (rotation around wrist axis) in radians
// Uses index MCP (5) and pinky MCP (17) to detect hand tilt/twist
export function getHandRollAngle(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  const indexMCP = landmarks[5];
  const pinkyMCP = landmarks[17];
  // Angle of the line from pinky to index knuckle relative to horizontal
  return Math.atan2(pinkyMCP.y - indexMCP.y, pinkyMCP.x - indexMCP.x);
}

export function smoothPosition(current, previous, alpha = 0.35) {
  if (!previous) return current;
  return {
    x: previous.x + alpha * (current.x - previous.x),
    y: previous.y + alpha * (current.y - previous.y),
  };
}
