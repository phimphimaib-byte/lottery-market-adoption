import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Globe from 'globe.gl';
import useHandTracking from '../hooks/useHandTracking';
import { getHandCenter, getCursorPosition, smoothPosition, classifyGesture, getHandRollAngle } from '../utils/gestureRecognizer';
import { provinceMap, regionColors } from '../data/provinceMapping';

function computeCentroid(coords) {
  let totalLat = 0, totalLng = 0, count = 0;
  const processRing = (ring) => {
    for (const [lng, lat] of ring) { totalLng += lng; totalLat += lat; count++; }
  };
  if (Array.isArray(coords[0][0][0])) {
    coords.forEach(poly => poly.forEach(processRing));
  } else {
    coords.forEach(processRing);
  }
  return count > 0 ? { lat: totalLat / count, lng: totalLng / count } : { lat: 13, lng: 100 };
}

const COUNTRY_COORDS = {
  "Hong Kong": { lat: 22.32, lng: 114.17 },
  "Australia": { lat: -25.27, lng: 133.78 },
  "Laos": { lat: 19.86, lng: 102.50 },
  "Israel": { lat: 31.05, lng: 34.85 },
  "Germany": { lat: 51.17, lng: 10.45 },
  "Taiwan": { lat: 23.70, lng: 120.96 },
  "South Korea": { lat: 35.91, lng: 127.77 },
  "France": { lat: 46.23, lng: 2.21 },
};

const COUNTRY_FLAG_CODE = {
  "Hong Kong": "hk",
  "Australia": "au",
  "Laos": "la",
  "Israel": "il",
  "Germany": "de",
  "Taiwan": "tw",
  "South Korea": "kr",
  "France": "fr",
};

const EARTH_IMG = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_IMG = 'https://unpkg.com/three-globe/example/img/earth-topology.png';

export default function GlobeView({ customers = [], onSelectProvince, onSelectRegion }) {
  const globeContainerRef = useRef(null);
  const globeRef = useRef(null);
  const { videoRef, isTracking, isLoading, error, start, stop, onFrameRef } = useHandTracking();
  const [gesture, setGesture] = useState('none');
  const [rightGesture, setRightGesture] = useState('none');
  const [cursorPos, setCursorPos] = useState(null);
  const smoothRef = useRef(null);
  const rightSmoothRef = useRef(null);
  const prevPosRef = useRef(null);
  const rightPrevGestureRef = useRef('none');
  const leftPrevGestureRef = useRef('none');
  const pinchTimerRef = useRef(0);
  const prevRollRef = useRef(null);
  const [geoData, setGeoData] = useState({ thailand: null, world: null });
  const [selectedInfo, setSelectedInfo] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [drillLevel, setDrillLevel] = useState('overview'); // 'overview' | 'region' | 'province'
  const [drillRegion, setDrillRegion] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const customerDotsRef = useRef([]);
  const provinceCoordsRef = useRef({});
  const allPolygonsRef = useRef([]);
  const selectProvinceRef = useRef(null);
  const selectedInfoRef = useRef(null);
  selectedInfoRef.current = selectedInfo;

  // Load geo data
  useEffect(() => {
    Promise.all([
      fetch('/thailand.json').then(r => r.json()),
      fetch('/world.geojson').then(r => r.json()),
    ]).then(([thGeo, worldGeo]) => {
      const coords = {};
      thGeo.features.forEach(f => {
        const id = f.properties.id;
        if (provinceMap[id]) coords[id] = computeCentroid(f.geometry.coordinates);
      });
      provinceCoordsRef.current = coords;
      setGeoData({ thailand: thGeo, world: worldGeo });
    }).catch(console.error);
  }, []);

  // Build customer dots by province/country (depends on geoData for PROVINCE_COORDS)
  const customerDots = useMemo(() => {
    if (!customers.length || !geoData.thailand) return [];
    const groups = {};
    customers.forEach(c => {
      const key = c.provinceId || c.province || 'unknown';
      if (!groups[key]) groups[key] = { customers: [], totalAmount: 0, tickets: 0 };
      groups[key].customers.push(c);
      groups[key].totalAmount += c.amount;
      groups[key].tickets += c.tickets;
    });

    const dots = [];
    Object.entries(groups).forEach(([key, g]) => {
      let lat, lng, label;
      const PC = provinceCoordsRef.current;
      if (PC[key]) {
        lat = PC[key].lat; lng = PC[key].lng;
        label = provinceMap[key]?.name_th || key;
      } else if (COUNTRY_COORDS[key]) {
        lat = COUNTRY_COORDS[key].lat; lng = COUNTRY_COORDS[key].lng;
        label = key;
      } else return;

      dots.push({
        lat, lng, label, key,
        flagCode: COUNTRY_FLAG_CODE[key] || null,
        size: Math.min(0.6, 0.05 + g.customers.length * 0.04),
        color: PC[key] ? (regionColors[provinceMap[key]?.region]?.stroke || '#DC0000') : '#ff6600',
        count: g.customers.length,
        amount: g.totalAmount,
        tickets: g.tickets,
        provinceId: PC[key] ? key : null,
        customers: g.customers,
      });
    });
    customerDotsRef.current = dots;
    return dots;
  }, [customers, geoData]);

  // Combine world + thailand polygons (thailand provinces on top with colors)
  const allPolygons = useMemo(() => {
    const polys = [];
    // World countries (transparent overlay for borders)
    if (geoData.world) {
      geoData.world.features.forEach(f => {
        polys.push({ ...f, _type: 'world', _name: f.properties?.NAME || f.properties?.name || '' });
      });
    }
    // Thailand provinces (colored by region)
    if (geoData.thailand) {
      geoData.thailand.features.forEach(f => {
        const id = f.properties.id;
        const info = provinceMap[id];
        if (!info) return;
        // Count customers for this province
        const dot = customerDots.find(d => d.provinceId === id);
        polys.push({
          ...f,
          _type: 'province',
          _id: id,
          _name: info.name_th,
          _region: info.region,
          _color: regionColors[info.region]?.stroke || '#4CAF50',
          _hasData: !!dot,
          _count: dot?.count || 0,
          _amount: dot?.amount || 0,
          _tickets: dot?.tickets || 0,
          _customers: dot?.customers || [],
        });
      });
    }
    allPolygonsRef.current = polys;
    return polys;
  }, [geoData, customerDots]);

  // Build region groups for drill-down
  const regionGroups = useMemo(() => {
    const groups = {};
    customerDots.forEach(d => {
      if (!d.provinceId) return;
      const info = provinceMap[d.provinceId];
      if (!info) return;
      const r = info.region;
      if (!groups[r]) groups[r] = { label: regionColors[r]?.label || r, color: regionColors[r]?.stroke || '#DC0000', provinces: [], count: 0, amount: 0, tickets: 0 };
      groups[r].provinces.push(d);
      groups[r].count += d.count;
      groups[r].amount += d.amount;
      groups[r].tickets += d.tickets;
    });
    return groups;
  }, [customerDots]);

  // Navigate to region level
  const drillToRegion = useCallback((regionKey) => {
    const globe = globeRef.current;
    setDrillLevel('region');
    setDrillRegion(regionKey);
    setSelectedInfo(null);
    setSelectedCustomer(null);
    // Zoom to roughly the region center
    const regionCenters = {
      north: { lat: 18.5, lng: 99, alt: 0.8 },
      northeast: { lat: 16, lng: 103, alt: 0.8 },
      central: { lat: 14.5, lng: 100.5, alt: 0.6 },
      east: { lat: 13, lng: 101.5, alt: 0.6 },
      west: { lat: 15, lng: 98.5, alt: 0.7 },
      south: { lat: 9, lng: 100, alt: 0.8 },
    };
    const c = regionCenters[regionKey] || { lat: 13.2, lng: 100.5, alt: 1.0 };
    if (globe) globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: c.alt }, 800);
  }, []);

  // Select a province — zoom in + show detail
  const selectProvince = useCallback((feat) => {
    const globe = globeRef.current;
    if (!feat._hasData) return;
    if (globe) {
      globe.controls().autoRotate = false;
      const coord = provinceCoordsRef.current[feat._id];
      if (coord) globe.pointOfView({ lat: coord.lat, lng: coord.lng, altitude: 0.15 }, 1000);
    }
    setDrillLevel('province');
    const info = provinceMap[feat._id];
    if (info) setDrillRegion(info.region);
    setSelectedInfo({
      label: feat._name,
      color: feat._color,
      count: feat._count,
      amount: feat._amount,
      tickets: feat._tickets,
      customers: feat._customers,
      provinceId: feat._id,
    });
    setSelectedCustomer(null);
  }, []);
  selectProvinceRef.current = selectProvince;

  // Select a dot (INTL or province)
  const selectDotRef = useRef(null);
  const selectDot = useCallback((d) => {
    const globe = globeRef.current;
    if (globe) {
      globe.controls().autoRotate = false;
      globe.pointOfView({ lat: d.lat, lng: d.lng, altitude: 0.25 }, 1000);
    }
    if (d.provinceId) {
      setDrillLevel('province');
      const info = provinceMap[d.provinceId];
      if (info) setDrillRegion(info.region);
    }
    setSelectedInfo(d);
    setSelectedCustomer(null);
  }, []);
  selectDotRef.current = selectDot;

  // Initialize Globe
  useEffect(() => {
    if (!globeContainerRef.current || globeRef.current) return;

    const container = globeContainerRef.current;
    const globe = Globe()(container)
      .globeImageUrl(EARTH_IMG)
      .bumpImageUrl(BUMP_IMG)
      .backgroundColor('#000810')
      .showAtmosphere(true)
      .atmosphereColor('#4488ff')
      .atmosphereAltitude(0.2)
      .pointOfView({ lat: 13.2, lng: 100.5, altitude: 1.8 }, 0)
      // Customer dots (mainly for INTL)
      .pointsData([])
      .pointLat('lat')
      .pointLng('lng')
      .pointAltitude(d => d.provinceId ? 0 : d.size)
      .pointRadius(d => d.provinceId ? 0 : 0.4)
      .pointColor('color')
      .pointLabel(d => d.provinceId ? '' : `
        <div style="background:rgba(0,0,0,0.85);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.5;">
          <b style="color:#ff6b6b;">${d.label}</b><br/>
          ${d.count} คน | ฿${d.amount.toLocaleString('th-TH')}
        </div>
      `)
      .onPointClick(d => { if (!d.provinceId) { globe.controls().autoRotate = false; selectDot(d); } })
      // Polygons: world + thailand provinces
      .polygonsData([])
      .polygonCapColor(f => {
        if (f._type === 'province') {
          if (f._id === hoveredId) return f._color + 'dd';
          return f._hasData ? f._color + '99' : f._color + '40';
        }
        return 'rgba(200,200,200,0.03)';
      })
      .polygonSideColor(f => f._type === 'province' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.03)')
      .polygonStrokeColor(f => f._type === 'province' ? '#ffffff' : 'rgba(255,255,255,0.15)')
      .polygonAltitude(f => {
        if (f._type === 'province') {
          if (f._id === hoveredId) return 0.04;
          return f._hasData ? 0.015 : 0.008;
        }
        return 0.004;
      })
      .polygonLabel(f => {
        if (f._type === 'province') {
          const info = f._hasData
            ? `<br/><span style="font-size:11px;color:#aaa;">${f._count} คน | ฿${f._amount.toLocaleString('th-TH')}</span>`
            : '<br/><span style="font-size:11px;color:#666;">ไม่มีข้อมูล</span>';
          return `<div style="background:rgba(0,0,0,0.85);color:#fff;padding:8px 12px;border-radius:8px;font-size:13px;">
            <b style="color:${f._color};">${f._name}</b>${info}
          </div>`;
        }
        return f._name ? `<div style="background:rgba(0,0,0,0.7);color:#fff;padding:4px 8px;border-radius:4px;font-size:11px;">${f._name}</div>` : '';
      })
      .onPolygonClick(f => {
        if (f._type === 'province' && f._hasData) { globe.controls().autoRotate = false; selectProvince(f); }
      })
      .onPolygonHover(f => {
        setHoveredId(f && f._type === 'province' ? f._id : null);
        container.style.cursor = (f && f._type === 'province' && f._hasData) ? 'pointer' : 'default';
      })
      // Flags on INTL bars
      .htmlElementsData([])
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(d => d.size + 0.02)
      .htmlElement(d => {
        const el = document.createElement('div');
        el.className = 'globe-flag';
        el.innerHTML = `<img src="https://flagcdn.com/w40/${d.flagCode}.png" alt="${d.label}" />`;
        el.onclick = () => { if (selectDotRef.current) { globe.controls().autoRotate = false; selectDotRef.current(d); } };
        return el;
      });

    const controls = globe.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;

    globeRef.current = globe;

    const onResize = () => {
      globe.width(container.clientWidth);
      globe.height(container.clientHeight);
    };
    window.addEventListener('resize', onResize);
    onResize();

    return () => { window.removeEventListener('resize', onResize); };
  }, [selectProvince, selectDot]);

  // Update polygons + points data
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.polygonsData(allPolygons);
    const intlDots = customerDots.filter(d => !d.provinceId);
    globe.pointsData(intlDots);
    globe.htmlElementsData(intlDots.filter(d => d.flagCode));
  }, [allPolygons, customerDots]);

  // Re-render polygons when hover changes
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe || !allPolygons.length) return;
    // Force polygon re-render by re-setting data
    globe.polygonsData(allPolygons);
  }, [hoveredId, allPolygons]);

  // Gesture ON/OFF
  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls();
    if (isTracking) {
      controls.enabled = false;
      controls.autoRotate = false;
    } else {
      controls.enabled = true;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
    }
  }, [isTracking]);

  // Hand gesture handler — supports two hands
  const handleFrame = useCallback((landmarks, allHands) => {
    const globe = globeRef.current;
    const container = globeContainerRef.current;
    if (!globe) return;

    // No hands at all
    if (!allHands || allHands.length === 0) {
      setGesture('none');
      setRightGesture('none');
      setCursorPos(null);
      prevPosRef.current = null;
      prevRollRef.current = null;
      rightPrevGestureRef.current = 'none';
      return;
    }

    // MediaPipe "Right" label = user's right hand (mirrored in video)
    // With 2 hands: assign control hand (Left label) and click hand (Right label)
    let controlLandmarks = null;
    let clickLandmarks = null;

    if (allHands.length === 1) {
      // Single hand: use as control hand (same behavior as before)
      controlLandmarks = allHands[0].landmarks;
      clickLandmarks = null;
    } else {
      // Two hands: Left label = control, Right label = click cursor
      for (const h of allHands) {
        if (h.label === 'Left') controlLandmarks = h.landmarks;
        else clickLandmarks = h.landmarks;
      }
      // Fallback: if both same label, use by X position (leftmost = control)
      if (!controlLandmarks && !clickLandmarks) {
        controlLandmarks = allHands[0].landmarks;
        clickLandmarks = allHands[1].landmarks;
      } else if (!controlLandmarks) {
        controlLandmarks = clickLandmarks;
        clickLandmarks = null;
      }
    }

    // Right hand not used
    setCursorPos(null);
    setRightGesture('none');

    // === LEFT HAND (globe control) ===
    if (!controlLandmarks) {
      setGesture('none');
      prevPosRef.current = null;
      return;
    }

    const raw = classifyGesture(controlLandmarks);
    const wrist = getHandCenter(controlLandmarks);
    const smoothed = wrist ? smoothPosition(wrist, smoothRef.current, 0.25) : null;
    smoothRef.current = smoothed;

    if (!smoothed) {
      prevPosRef.current = null;
      setGesture('none');
      return;
    }

    const pov = globe.pointOfView();

    // Open hand (5 นิ้ว) = ซูมเข้า
    if (raw === 'open') {
      setGesture('zoomIn');
      const newAlt = Math.max(0.15, pov.altitude - 0.02);
      globe.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: newAlt }, 0);
      prevPosRef.current = smoothed;
      return;
    }

    // Fist = ซูมออก
    if (raw === 'fist') {
      setGesture('zoomOut');
      const newAlt = Math.min(6, pov.altitude + 0.02);
      globe.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: newAlt }, 0);
      prevPosRef.current = smoothed;
      leftPrevGestureRef.current = raw;
      return;
    }

    // Point (ชี้นิ้วชี้) = หมุนโลก ตามการขยับ
    if (raw === 'point') {
      setGesture('move');
      if (prevPosRef.current) {
        const dx = (smoothed.x - prevPosRef.current.x) * 120;
        const dy = (smoothed.y - prevPosRef.current.y) * 80;
        if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
          globe.pointOfView({
            lat: Math.max(-85, Math.min(85, pov.lat - dy)),
            lng: pov.lng + dx,
            altitude: pov.altitude,
          }, 0);
        }
      }
      prevPosRef.current = smoothed;
      leftPrevGestureRef.current = raw;
      return;
    }

    // Victory/2 นิ้ว (ชี้+กลาง) = หมุนโลกแบบ joystick
    // เอียงมือไปทิศไหน โลกหมุนไปทิศนั้นเป็นสเต็ปคงที่
    if (raw === 'rotate') {
      setGesture('rotate');
      const STEP = 1.2; // องศาต่อเฟรม
      let dLat = 0, dLng = 0;

      // บิดข้อมือ → หมุนซ้าย-ขวา (ดูมุมเอียง ไม่ใช่ delta)
      const roll = getHandRollAngle(controlLandmarks);
      if (roll !== null) {
        // roll ~0 = มือตั้งตรง, บวก = เอียงขวา, ลบ = เอียงซ้าย
        if (roll > 0.25) dLng -= STEP;       // เอียงขวา → หมุนซ้าย
        else if (roll < -0.25) dLng += STEP;  // เอียงซ้าย → หมุนขวา
      }

      // ตำแหน่งมือบน-ล่าง → หมุนบน-ล่าง (ใช้ตำแหน่ง y สัมบูรณ์)
      // กลางจอ ~0.5, ยกมือขึ้น < 0.35, ลดมือลง > 0.65
      if (smoothed) {
        if (smoothed.y < 0.35) dLat += STEP;       // มืออยู่ข้างบน → หมุนขึ้น
        else if (smoothed.y > 0.65) dLat -= STEP;   // มืออยู่ข้างล่าง → หมุนลง
      }

      if (dLat !== 0 || dLng !== 0) {
        globe.pointOfView({
          lat: Math.max(-85, Math.min(85, pov.lat + dLat)),
          lng: pov.lng + dLng,
          altitude: pov.altitude,
        }, 0);
      }

      prevPosRef.current = smoothed;
      leftPrevGestureRef.current = raw;
      return;
    }
    prevRollRef.current = null;

    // Pinch 2 ครั้ง = คลิกเลือกจังหวัดตรงกลางจอ
    if (raw === 'pinch') {
      setGesture('pinch');
      const now = performance.now();
      if (leftPrevGestureRef.current !== 'pinch') {
        // Transition into pinch
        if (now - pinchTimerRef.current < 800) {
          // Second pinch! → toggle: if card open → close, else → select province
          pinchTimerRef.current = 0;
          if (selectedInfoRef.current) {
            setSelectedInfo(null);
            setSelectedCustomer(null);
            const cur = globe.pointOfView();
            globe.pointOfView({ lat: cur.lat, lng: cur.lng, altitude: 0.8 }, 800);
            globe.controls().autoRotate = false; // ใช้มืออยู่ ไม่เปิด autoRotate
            leftPrevGestureRef.current = raw;
            prevPosRef.current = null;
            return;
          }
          const centerCoords = globe.toGlobeCoords
            ? globe.toGlobeCoords(container.clientWidth / 2, container.clientHeight / 2)
            : null;
          if (centerCoords) {
            const PC = provinceCoordsRef.current;
            let bestId = null, bestDist = Infinity, bestType = null;

            // Check Thai provinces
            for (const [id, coord] of Object.entries(PC)) {
              const d = Math.hypot(coord.lat - centerCoords.lat, coord.lng - centerCoords.lng);
              if (d < bestDist) { bestDist = d; bestId = id; bestType = 'province'; }
            }

            // Check international countries
            for (const [name, coord] of Object.entries(COUNTRY_COORDS)) {
              const d = Math.hypot(coord.lat - centerCoords.lat, coord.lng - centerCoords.lng);
              if (d < bestDist) { bestDist = d; bestId = name; bestType = 'country'; }
            }

            if (bestId && bestDist < 5) {
              if (bestType === 'province') {
                const feat = allPolygonsRef.current.find(f => f._type === 'province' && f._id === bestId);
                if (feat && feat._hasData && selectProvinceRef.current) {
                  selectProvinceRef.current(feat);
                }
              } else {
                const dot = customerDotsRef.current.find(d => d.key === bestId);
                if (dot && selectDotRef.current) {
                  selectDotRef.current(dot);
                }
              }
            }
          }
        } else {
          pinchTimerRef.current = now;
        }
      }
      prevPosRef.current = null;
      leftPrevGestureRef.current = raw;
      return;
    }

    leftPrevGestureRef.current = raw;
    prevPosRef.current = smoothed;
    setGesture('none');
  }, []);

  useEffect(() => {
    onFrameRef.current = handleFrame;
  }, [handleFrame, onFrameRef]);

  // Back navigation
  const goBack = useCallback(() => {
    if (selectedCustomer) {
      setSelectedCustomer(null);
      return;
    }
    setSelectedInfo(null);
    const globe = globeRef.current;
    if (globe) {
      const cur = globe.pointOfView();
      globe.pointOfView({ lat: cur.lat, lng: cur.lng, altitude: 0.8 }, 800);
      if (!isTracking) {
        globe.controls().autoRotate = true;
        globe.controls().autoRotateSpeed = 0.3;
      }
    }
  }, [selectedCustomer, isTracking]);

  // Current region data for region-level view
  const currentRegionData = drillRegion ? regionGroups[drillRegion] : null;

  return (
    <div className="globe-wrapper">
      <div ref={globeContainerRef} className="globe-canvas" />

      {/* Back button */}
      {(selectedInfo || selectedCustomer) && (
        <button className="globe-back-btn" onClick={goBack}>
          ← กลับ
        </button>
      )}

      <button
        className="gesture-toggle-btn"
        onClick={isTracking ? stop : start}
        disabled={isLoading}
      >
        {isLoading ? '⏳ กำลังโหลด...' : isTracking ? '🖐️ ON' : '🖐️ OFF'}
      </button>

      <div className={`webcam-preview ${isTracking ? 'visible' : ''}`}>
        <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        {(gesture !== 'none' || rightGesture !== 'none') && (
          <div className="gesture-badge">
            <span>{
              gesture === 'zoomIn' ? '🖐️ ซูมเข้า' :
              gesture === 'zoomOut' ? '✊ ซูมออก' :
              gesture === 'move' ? '☝️ เลื่อน' :
              gesture === 'rotate' ? '✌️ หมุน' :
              gesture === 'pinch' ? '🤏 เลือก' : ''
            }</span>
          </div>
        )}
      </div>

      {error && <div className="gesture-error">{error}</div>}

      {/* Center crosshair when tracking */}
      {isTracking && (
        <div className="globe-crosshair">+</div>
      )}

      {/* PROVINCE: Winner cards panel — only shows when a province/country is selected */}
      {selectedInfo && !selectedCustomer && (
        <div className="province-panel">
          <div className="province-panel-header">
            <div className="province-panel-title">{selectedInfo.label}</div>
            <div className="province-panel-sub">
              {drillRegion && drillRegion !== 'intl' ? regionColors[drillRegion]?.label : 'ต่างประเทศ'}
            </div>
            <div className="province-panel-stats">
              <span>{selectedInfo.count} คน</span>
              <span>{selectedInfo.tickets} ใบ</span>
              <span className="green">฿{selectedInfo.amount.toLocaleString('th-TH')}</span>
            </div>
          </div>
          <div className="province-panel-list">
            {selectedInfo.customers.map((c, i) => (
              <div key={c.id || i} className="winner-card" onClick={() => setSelectedCustomer(c)}>
                <img
                  className="winner-card-photo"
                  src={c.avatar}
                  alt={c.name}
                  onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${c.name}&background=1a1a2e&color=ff6b6b&size=100`; }}
                />
                <div className="winner-card-body">
                  <div className="winner-card-name">{c.name} {c.surname}</div>
                  <div className="winner-card-row">
                    <span className="winner-tag red">{c.tickets} ใบ</span>
                    <span className="winner-tag green">฿{c.amount.toLocaleString('th-TH')}</span>
                  </div>
                  {c.drawDate && <div className="winner-card-date">งวด {c.drawDate}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CUSTOMER DETAIL popup */}
      {selectedCustomer && (
        <div className="winner-popup-overlay" onClick={() => setSelectedCustomer(null)}>
          <div className="winner-popup" onClick={(e) => e.stopPropagation()}>
            <button className="winner-popup-close" onClick={() => setSelectedCustomer(null)}>&times;</button>
            <div className="winner-popup-img-area">
              <img
                className="winner-popup-img"
                src={selectedCustomer.avatar}
                alt={selectedCustomer.name}
                onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${selectedCustomer.name}&background=1a1a2e&color=ff6b6b&size=200`; }}
              />
            </div>
            <div className="winner-popup-body">
              <div className="winner-popup-name">{selectedCustomer.name} {selectedCustomer.surname}</div>
              <div className="winner-popup-location">
                {selectedInfo?.label}
                {drillRegion && drillRegion !== 'intl' && ` · ${regionColors[drillRegion]?.label}`}
              </div>
              <div className="winner-popup-stats">
                <div className="winner-popup-stat">
                  <div className="winner-popup-stat-val red">{selectedCustomer.tickets}</div>
                  <div className="winner-popup-stat-lbl">ใบ</div>
                </div>
                <div className="winner-popup-stat">
                  <div className="winner-popup-stat-val">฿{selectedCustomer.amount.toLocaleString('th-TH')}</div>
                  <div className="winner-popup-stat-lbl">บาท</div>
                </div>
              </div>
              {selectedCustomer.drawDate && (
                <div className="winner-popup-date">งวดวันที่ {selectedCustomer.drawDate}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
