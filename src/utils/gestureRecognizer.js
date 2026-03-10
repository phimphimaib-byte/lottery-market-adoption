// Landmark indices
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;
const WRIST = 0;

function isFingerExtended(landmarks, tipIdx, pipIdx) {
  // finger tip is higher (smaller y) than PIP = extended
  return landmarks[tipIdx].y < landmarks[pipIdx].y - 0.02;
}

export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return 'none';

  const indexExt = isFingerExtended(landmarks, INDEX_TIP, INDEX_PIP);
  const middleExt = isFingerExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP);
  const ringExt = isFingerExtended(landmarks, RING_TIP, RING_PIP);
  const pinkyExt = isFingerExtended(landmarks, PINKY_TIP, PINKY_PIP);

  // Count extended fingers (not counting thumb — too unreliable)
  const extCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  // Fist / click: 0-1 fingers extended
  if (extCount <= 1 && !indexExt) {
    return 'fist';
  }

  // Open hand / move: 2+ fingers extended
  if (extCount >= 2) {
    return 'open';
  }

  return 'open'; // default to move so cursor always works
}

export function getCursorPosition(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  // Use wrist for more stable tracking, mirror X
  const wrist = landmarks[WRIST];
  return { x: 1 - wrist.x, y: wrist.y };
}

// Exponential moving average for cursor smoothing
export function smoothPosition(current, previous, alpha = 0.4) {
  if (!previous) return current;
  return {
    x: previous.x + alpha * (current.x - previous.x),
    y: previous.y + alpha * (current.y - previous.y),
  };
}
