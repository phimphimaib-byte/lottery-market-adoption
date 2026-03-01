import { useState, useMemo, useEffect } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import thailandGeo from '../data/thailand.json';
import { provinceMap, regionColors } from '../data/provinceMapping';
import { getProvinceStats, getCustomersByProvince } from '../data/mockData';

const WIDTH = 600;
const HEIGHT = 780;
const MAX_CARDS = 8;

const allStats = Object.keys(provinceMap).map((id) => getProvinceStats(id));
const maxCustomers = Math.max(...allStats.map((s) => s.totalCustomers), 1);

// ===== Point-in-polygon (ray casting) =====
function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ===== Generate random dots inside a GeoJSON feature (projected space) =====
function generateDotsInPolygon(feature, projection, n, minDist = 6) {
  const path = geoPath().projection(projection);
  const [[xMin, yMin], [xMax, yMax]] = path.bounds(feature);

  // Project polygon rings for hit-testing
  const coords = feature.geometry.coordinates;
  const rings = feature.geometry.type === 'MultiPolygon'
    ? coords.flatMap((poly) => poly.map((ring) => ring.map((c) => projection(c)).filter(Boolean)))
    : coords.map((ring) => ring.map((c) => projection(c)).filter(Boolean));

  // Seeded PRNG
  let seed = (feature.properties.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 997;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };

  const points = [];
  let attempts = 0;
  while (points.length < n && attempts < n * 120) {
    attempts++;
    const px = xMin + rand() * (xMax - xMin);
    const py = yMin + rand() * (yMax - yMin);
    if (!rings.some((ring) => pointInPolygon(px, py, ring))) continue;
    if (points.some((p) => Math.hypot(p[0] - px, p[1] - py) < minDist)) continue;
    points.push([px, py]);
  }
  return points;
}

// ===== Animated count-up hook =====
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

function ThailandMap({ selectedRegion, selectedProvince, onSelectRegion, onSelectProvince }) {
  const [tooltip, setTooltip] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [highlightedId, setHighlightedId] = useState(null);
  const [dotTooltip, setDotTooltip] = useState(null);

  // Reset showAll when province changes
  const prevProvRef = useMemo(() => ({ prev: null }), []);
  if (prevProvRef.prev !== selectedProvince) {
    prevProvRef.prev = selectedProvince;
    if (showAll) setShowAll(false);
    if (highlightedId) setHighlightedId(null);
  }

  // Auto-scroll to highlighted card
  useEffect(() => {
    if (highlightedId) {
      const el = document.getElementById(`card-${highlightedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightedId]);

  // Fixed base projection
  const baseProjection = useMemo(
    () => geoMercator().center([100.5, 13.2]).scale(3200).translate([WIDTH / 2, HEIGHT / 2]),
    []
  );
  const pathGen = useMemo(() => geoPath().projection(baseProjection), [baseProjection]);

  // ALL province centroids (for labels)
  const allLabels = useMemo(() => {
    return thailandGeo.features
      .map((f) => {
        const info = provinceMap[f.properties.id];
        if (!info) return null;
        const c = pathGen.centroid(f);
        if (!c || isNaN(c[0])) return null;
        return { id: f.properties.id, x: c[0], y: c[1], name: info.name_th, region: info.region };
      })
      .filter(Boolean);
  }, [pathGen]);

  // Zoom transform
  const zoom = useMemo(() => {
    let features = null;
    if (selectedProvince) {
      const f = thailandGeo.features.find((ft) => ft.properties.id === selectedProvince);
      if (f) features = [f];
    } else if (selectedRegion) {
      features = thailandGeo.features.filter(
        (ft) => provinceMap[ft.properties.id]?.region === selectedRegion
      );
    }
    if (features && features.length > 0) {
      const fc = { type: 'FeatureCollection', features };
      const [[x0, y0], [x1, y1]] = pathGen.bounds(fc);
      const bw = x1 - x0 || 1;
      const bh = y1 - y0 || 1;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const pad = selectedProvince ? 140 : 60;
      const s = Math.min((WIDTH - pad) / bw, (HEIGHT - pad) / bh);
      return { tx: WIDTH / 2 - cx * s, ty: HEIGHT / 2 - cy * s, s };
    }
    return { tx: 0, ty: 0, s: 1 };
  }, [selectedProvince, selectedRegion, pathGen]);

  // Winner glow dots (random-in-polygon)
  const winnerDots = useMemo(() => {
    if (!selectedProvince) return [];
    const feature = thailandGeo.features.find((f) => f.properties.id === selectedProvince);
    if (!feature) return [];
    const customers = getCustomersByProvince(selectedProvince);
    if (customers.length === 0) return [];
    const dots = generateDotsInPolygon(feature, baseProjection, customers.length);
    return customers.map((c, i) => ({
      customer: c,
      x: dots[i]?.[0] ?? 0,
      y: dots[i]?.[1] ?? 0,
      valid: !!dots[i],
    })).filter((d) => d.valid);
  }, [selectedProvince, baseProjection]);

  // Overlay panel: side + customers + stats
  const overlayData = useMemo(() => {
    if (!selectedProvince) return null;
    const feature = thailandGeo.features.find((f) => f.properties.id === selectedProvince);
    if (!feature) return null;
    const customers = getCustomersByProvince(selectedProvince);
    if (customers.length === 0) return null;
    const centroid = pathGen.centroid(feature);
    const screenX = centroid[0] * zoom.s + zoom.tx;
    const side = screenX < WIDTH / 2 ? 'left' : 'right';
    const effectiveMax = showAll ? customers.length : MAX_CARDS;
    const visible = customers.slice(0, effectiveMax);
    const remaining = Math.max(0, customers.length - effectiveMax);
    const info = provinceMap[selectedProvince];
    const color = regionColors[info?.region]?.stroke;
    const stats = getProvinceStats(selectedProvince);
    return {
      side, visible, remaining, color,
      provinceName: info?.name_th,
      totalAmount: stats.totalAmount,
      winnerCount: stats.totalCustomers,
      totalTickets: stats.totalTickets,
    };
  }, [selectedProvince, pathGen, zoom, showAll]);

  // Animated count-up values
  const animAmount = useCountUp(overlayData?.totalAmount || 0);
  const animCount = useCountUp(overlayData?.winnerCount || 0, 500);

  // Region buttons
  const regionButtons = [
    { id: null, label: 'ทั้งหมด' },
    ...Object.entries(regionColors).map(([id, v]) => ({ id, label: v.label })),
  ];

  // Event handlers
  const handleMouseEnter = (e, feature) => {
    const id = feature.properties.id;
    const info = provinceMap[id];
    if (!info) return;
    setHoveredId(id);
    const stats = getProvinceStats(id);
    setTooltip({
      x: e.clientX, y: e.clientY,
      name: info.name_th, nameEn: feature.properties.name,
      region: regionColors[info.region]?.label || '',
      regionKey: info.region,
      customers: stats.totalCustomers,
      tickets: stats.totalTickets,
      amount: stats.totalAmount,
    });
  };
  const handleMouseMove = (e) => {
    if (tooltip) setTooltip((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : null));
  };
  const handleMouseLeave = () => { setHoveredId(null); setTooltip(null); };
  const handleProvinceClick = (feature) => {
    const id = feature.properties.id;
    const info = provinceMap[id];
    if (!info) return;
    setTooltip(null); setHoveredId(null);
    if (selectedProvince === id) return;
    if (!selectedRegion) onSelectRegion(info.region);
    onSelectProvince(id);
  };

  const labelSize = (isInRegion) => {
    if (selectedProvince) return 7 / zoom.s;
    if (selectedRegion) return isInRegion ? 10 / zoom.s : 8 / zoom.s;
    return 7;
  };

  return (
    <div className="map-container">
      {/* Region bar */}
      <div className="region-bar">
        {regionButtons.map((btn) => {
          const isActive = btn.id === selectedRegion;
          const color = btn.id ? regionColors[btn.id]?.stroke : '#FF2800';
          return (
            <button
              key={btn.id || 'all'}
              className={`region-btn ${isActive ? 'active' : ''}`}
              style={isActive ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color, color }}
              onClick={() => { onSelectRegion(btn.id); onSelectProvince(null); setShowAll(false); }}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* SVG Map */}
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="map-svg">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow-strong"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="dot-glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        <g
          style={{
            transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`,
            transition: 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
            transformOrigin: '0 0',
          }}
        >
          {/* Province paths */}
          {thailandGeo.features.map((feature) => {
            const id = feature.properties.id;
            const info = provinceMap[id];
            if (!info) return null;
            const colors = regionColors[info.region];
            const d = pathGen(feature);
            if (!d) return null;

            const isHovered = hoveredId === id;
            const isSelected = selectedProvince === id;
            const inRegion = !selectedRegion || info.region === selectedRegion;
            const choropleth = 0.30 + (getProvinceStats(id).totalCustomers / maxCustomers) * 0.45;

            let fill, stroke, strokeW, opacity;
            if (isSelected) {
              fill = colors.fill.replace('0.30', '0.70');
              stroke = '#ffffff';
              strokeW = 2 / zoom.s;
              opacity = 1;
            } else if (isHovered && inRegion) {
              fill = colors.fill.replace('0.30', '0.55');
              stroke = '#ffffff';
              strokeW = 1.2 / zoom.s;
              opacity = 1;
            } else if (inRegion) {
              fill = colors.fill.replace('0.30', String(choropleth));
              stroke = colors.stroke;
              strokeW = (selectedRegion ? 0.8 : 0.5) / zoom.s;
              opacity = selectedProvince ? 0.3 : 1;
            } else {
              fill = 'rgba(20,30,50,0.5)';
              stroke = 'rgba(60,80,100,0.3)';
              strokeW = 0.3 / zoom.s;
              opacity = 0.25;
            }

            return (
              <path
                key={id} d={d}
                fill={fill} stroke={stroke} strokeWidth={strokeW} opacity={opacity}
                filter={isSelected ? 'url(#glow-strong)' : isHovered ? 'url(#glow)' : 'none'}
                style={{ cursor: inRegion ? 'pointer' : 'default', transition: 'fill 0.3s, stroke 0.3s, opacity 0.4s' }}
                onMouseEnter={inRegion && !selectedProvince ? (e) => handleMouseEnter(e, feature) : undefined}
                onMouseMove={inRegion && !selectedProvince ? handleMouseMove : undefined}
                onMouseLeave={inRegion && !selectedProvince ? handleMouseLeave : undefined}
                onClick={inRegion ? () => handleProvinceClick(feature) : undefined}
              />
            );
          })}

          {/* Province labels */}
          {allLabels.map((l) => {
            const inRegion = !selectedRegion || l.region === selectedRegion;
            const isSelected = selectedProvince === l.id;
            if (selectedProvince && !isSelected) {
              return (
                <text
                  key={`lbl-${l.id}`} x={l.x} y={l.y}
                  textAnchor="middle" pointerEvents="none"
                  fill="rgba(255,255,255,0.15)"
                  fontSize={6 / zoom.s} fontWeight="500"
                  style={{ transition: 'font-size 0.5s, fill 0.4s' }}
                >{l.name}</text>
              );
            }
            const fs = labelSize(inRegion);
            const fillColor = inRegion ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
            return (
              <text
                key={`lbl-${l.id}`} x={l.x} y={l.y}
                textAnchor="middle" pointerEvents="none"
                fill={fillColor} fontSize={fs}
                fontWeight={inRegion ? '700' : '400'}
                stroke="rgba(0,0,0,0.7)" strokeWidth={fs * 0.28}
                paintOrder="stroke"
                style={{ transition: 'font-size 0.5s, fill 0.4s' }}
              >{l.name}</text>
            );
          })}

          {/* Glow pulse dots — winner positions on map */}
          {selectedProvince && winnerDots.map((dot, i) => {
            const isHl = highlightedId === dot.customer.id;
            const r = (isHl ? 4.5 : 3) / zoom.s;
            const rOuter = 6 / zoom.s;
            return (
              <g key={`dot-${dot.customer.id}`}>
                <circle
                  cx={dot.x} cy={dot.y} r={rOuter}
                  fill="none" stroke="#00e5ff" strokeWidth={1.2 / zoom.s}
                  opacity={0.5}
                  className="dot-pulse-ring"
                  style={{ transformOrigin: `${dot.x}px ${dot.y}px`, animationDelay: `${i * 0.2}s` }}
                />
                <circle
                  cx={dot.x} cy={dot.y} r={r}
                  fill={isHl ? '#00ffaa' : '#00e5ff'}
                  stroke={isHl ? '#fff' : 'rgba(0,229,255,0.4)'}
                  strokeWidth={(isHl ? 1.5 : 0.5) / zoom.s}
                  filter="url(#dot-glow)"
                  className="dot-core"
                  style={{ cursor: 'pointer', transition: 'fill 0.2s, stroke 0.2s', animationDelay: `${i * 0.08}s` }}
                  onMouseEnter={(e) => {
                    setHighlightedId(dot.customer.id);
                    setDotTooltip({ x: e.clientX, y: e.clientY, name: `${dot.customer.name} ${dot.customer.surname}`, amount: dot.customer.amount });
                  }}
                  onMouseMove={(e) => { if (dotTooltip) setDotTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null); }}
                  onMouseLeave={() => { setHighlightedId(null); setDotTooltip(null); }}
                  onClick={() => setHighlightedId(dot.customer.id)}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {/* Region legend */}
      <div className="map-legend">
        <div className="legend-title">ภูมิภาค</div>
        {Object.entries(regionColors).map(([key, val]) => (
          <div
            key={key}
            className={`legend-item ${selectedRegion === key ? 'legend-active' : ''}`}
            onClick={() => { onSelectRegion(key); onSelectProvince(null); setShowAll(false); }}
          >
            <span className="legend-swatch" style={{ background: val.stroke }} />
            <span className="legend-label">{val.label}</span>
          </div>
        ))}
      </div>

      {/* Overlay card panel (left or right) */}
      {overlayData && (
        <div
          key={selectedProvince}
          className={`overlay-panel overlay-${overlayData.side}`}
          style={{ borderColor: overlayData.color }}
        >
          <div className="overlay-header">
            <div className="overlay-title" style={{ color: overlayData.color }}>
              {overlayData.provinceName}
            </div>
            <div className="overlay-stats-row">
              <span className="overlay-stat-item">
                <span className="overlay-stat-value">{animCount}</span>
                <span className="overlay-stat-label">คน</span>
              </span>
              <span className="overlay-stat-item">
                <span className="overlay-stat-value">{overlayData.totalTickets}</span>
                <span className="overlay-stat-label">ใบ</span>
              </span>
              <span className="overlay-stat-item">
                <span className="overlay-stat-value neon-green">฿{animAmount.toLocaleString('th-TH')}</span>
                <span className="overlay-stat-label">ยอดรวม</span>
              </span>
            </div>
          </div>
          <div className="overlay-cards">
            {overlayData.visible.map((c, i) => (
              <div
                key={c.id}
                id={`card-${c.id}`}
                className={`overlay-card ${highlightedId === c.id ? 'card-highlighted' : ''}`}
                style={{ animationDelay: `${i * 0.05}s` }}
                onMouseEnter={() => setHighlightedId(c.id)}
                onMouseLeave={() => setHighlightedId(null)}
              >
                <img
                  className="overlay-avatar"
                  src={c.avatar}
                  alt={c.name}
                  onError={(e) => {
                    e.target.src = `https://ui-avatars.com/api/?name=${c.name}&background=0d1528&color=FF2800&size=100`;
                  }}
                />
                <div className="overlay-body">
                  <div className="overlay-name">{c.name} {c.surname}</div>
                  <div className="overlay-meta">
                    <span className="oc-badge tickets">{c.tickets} ใบ</span>
                    <span className="oc-badge money">฿{c.amount.toLocaleString('th-TH')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {overlayData.remaining > 0 && (
            <button className="overlay-more-btn" onClick={() => setShowAll(true)}>
              +{overlayData.remaining} ดูทั้งหมด
            </button>
          )}
        </div>
      )}

      {/* Province info bar (bottom) */}
      {selectedProvince && (() => {
        const info = provinceMap[selectedProvince];
        const stats = getProvinceStats(selectedProvince);
        const color = regionColors[info?.region]?.stroke;
        return (
          <div className="province-info-bar" style={{ borderColor: color }}>
            <span className="pib-name" style={{ color }}>{info?.name_th}</span>
            <span className="pib-stat">{stats.totalCustomers} คน</span>
            <span className="pib-stat">{stats.totalTickets} ใบ</span>
            <span className="pib-stat">฿{stats.totalAmount.toLocaleString('th-TH')}</span>
          </div>
        );
      })()}

      {/* Province tooltip */}
      {tooltip && !selectedProvince && (
        <div className="map-tooltip" style={{ left: tooltip.x + 16, top: tooltip.y - 10, borderColor: regionColors[tooltip.regionKey]?.stroke }}>
          <div className="map-tooltip-name" style={{ color: regionColors[tooltip.regionKey]?.stroke }}>{tooltip.name}</div>
          <div className="map-tooltip-sub">{tooltip.nameEn} | {tooltip.region}</div>
          <div className="map-tooltip-stats">
            <span>ลูกค้า <b>{tooltip.customers}</b></span>
            <span>ใบ <b>{tooltip.tickets}</b></span>
            <span>฿<b>{tooltip.amount.toLocaleString('th-TH')}</b></span>
          </div>
        </div>
      )}

      {/* Dot tooltip */}
      {dotTooltip && (
        <div className="dot-tooltip" style={{ left: dotTooltip.x + 16, top: dotTooltip.y - 10 }}>
          <div className="dot-tooltip-name">{dotTooltip.name}</div>
          <div className="dot-tooltip-amount">฿{dotTooltip.amount.toLocaleString('th-TH')}</div>
        </div>
      )}
    </div>
  );
}

export default ThailandMap;
