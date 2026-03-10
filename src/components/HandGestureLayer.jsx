import { useState, useEffect, useRef, useCallback } from 'react';
import useHandTracking from '../hooks/useHandTracking';
import { classifyGesture, getCursorPosition, smoothPosition } from '../utils/gestureRecognizer';

const GESTURE_LABELS = { open: 'เลื่อน', fist: 'คลิก!', none: '' };
const GESTURE_ICONS = { open: '🖐️', fist: '✊', none: '—' };

export default function HandGestureLayer({ mapRef, containerRef, onClickRef }) {
  const { videoRef, isTracking, isLoading, error, start, stop, onFrameRef } = useHandTracking();
  const [cursorPos, setCursorPos] = useState(null);
  const [gesture, setGesture] = useState('none');
  const smoothRef = useRef(null);
  const prevGestureRef = useRef('none');
  const clickCooldownRef = useRef(0);
  const maplibreRef = useRef(null);

  // Load maplibregl once
  useEffect(() => {
    import('maplibre-gl').then((mod) => { maplibreRef.current = mod.default || mod; });
  }, []);

  // Disable map scroll/drag interactions when gesture is ON, restore when OFF
  useEffect(() => {
    const map = mapRef?.current;
    if (!map) return;
    if (isTracking) {
      map.scrollZoom.disable();
      map.dragPan.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
    } else {
      map.scrollZoom.enable();
      map.dragPan.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
    }
  }, [isTracking, mapRef]);

  const handleFrame = useCallback((landmarks) => {
    const map = mapRef?.current;
    const container = containerRef?.current;
    const mgl = maplibreRef.current;
    if (!map || !container || !mgl) return;

    const raw = classifyGesture(landmarks);
    const curRaw = getCursorPosition(landmarks);
    const now = performance.now();

    // Smooth cursor
    const smoothed = curRaw ? smoothPosition(curRaw, smoothRef.current, 0.3) : null;
    smoothRef.current = smoothed;

    if (!smoothed) {
      setCursorPos(null);
      setGesture('none');
      prevGestureRef.current = 'none';
      return;
    }

    const rect = container.getBoundingClientRect();
    const sx = smoothed.x * rect.width;
    const sy = smoothed.y * rect.height;
    setCursorPos({ x: sx, y: sy });
    setGesture(raw);

    // Hover effect: change cursor style based on what's under the hand
    try {
      const feats = map.queryRenderedFeatures([sx, sy], { layers: ['provinces-fill'] });
      map.getCanvas().style.cursor = feats.length > 0 ? 'pointer' : '';
    } catch {}

    // FIST → click (only on transition from open → fist)
    if (raw === 'fist' && prevGestureRef.current === 'open' && now > clickCooldownRef.current) {
      clickCooldownRef.current = now + 600;
      if (onClickRef?.current) {
        onClickRef.current(sx, sy);
      }
    }

    prevGestureRef.current = raw;
  }, [mapRef, containerRef]);

  useEffect(() => {
    onFrameRef.current = handleFrame;
  }, [handleFrame, onFrameRef]);

  return (
    <>
      {/* Toggle button */}
      <button
        className="gesture-toggle-btn"
        onClick={isTracking ? stop : start}
        disabled={isLoading}
      >
        {isLoading ? '⏳ กำลังโหลด...' : isTracking ? '🖐️ ON' : '🖐️ OFF'}
      </button>

      {/* Webcam preview */}
      <div className={`webcam-preview ${isTracking ? 'visible' : ''}`}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        {gesture !== 'none' && (
          <div className="gesture-badge">
            <span>{GESTURE_ICONS[gesture]}</span>
            <span>{GESTURE_LABELS[gesture]}</span>
          </div>
        )}
      </div>

      {error && <div className="gesture-error">{error}</div>}

      {/* Hand cursor */}
      {isTracking && cursorPos && (
        <div
          className={`hand-cursor ${gesture}`}
          style={{ left: cursorPos.x, top: cursorPos.y }}
        >
          <div className="hand-cursor-ring" />
          <div className="hand-cursor-dot" />
          {gesture === 'fist' && <div className="hand-cursor-click-ring" />}
        </div>
      )}
    </>
  );
}
