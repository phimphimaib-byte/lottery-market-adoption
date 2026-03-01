import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import thailandGeo from '../data/thailand.json';
import { provinceMap, regionColors } from '../data/provinceMapping';
import { getProvinceStats, getCustomersByProvince, getIntlCustomers, getTotalStats } from '../data/prizeData';

const MAX_CARDS = 8;
const THAI_CENTER = [100.5, 13.2];
const INTL_CENTER = [70, 25];
const INTL_ZOOM = 2;

// Fixed country coordinates [lng, lat]
const COUNTRY_COORDS = {
  "Hong Kong": [114.1694, 22.3193],
  "Australia": [133.7751, -25.2744],
  "Laos": [102.4955, 19.8563],
  "Israel": [34.8516, 31.0461],
  "Germany": [10.4515, 51.1657],
  "Taiwan": [120.9605, 23.6978],
  "South Korea": [127.7669, 35.9078],
  "France": [2.2137, 46.2276],
};

// Map edge-case province names to canonical country names
const INTL_COUNTRY_ALIAS = { 'ทำงานอยู่ที่ปารีส': 'France' };

// Map INTL country names → world.geojson NAME property (only when different)
const COUNTRY_TO_GEO_NAME = { 'Hong Kong': 'China' };
const INIT_ZOOM = 5.5;
const INIT_PITCH = 60;
const INIT_BEARING = -25;

// Reverse map: world.geojson NAME → INTL country name
const GEO_NAME_TO_COUNTRY = Object.fromEntries(
  Object.entries(COUNTRY_TO_GEO_NAME).map(([k, v]) => [v, k])
);

// Free dark basemap — no token required
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// ===== Compute bounding box [west, south, east, north] from a GeoJSON feature =====
function geoBBox(feature) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      if (coords[0] < w) w = coords[0];
      if (coords[0] > e) e = coords[0];
      if (coords[1] < s) s = coords[1];
      if (coords[1] > n) n = coords[1];
    } else {
      for (const c of coords) walk(c);
    }
  };
  walk(feature.geometry.coordinates);
  return [[w, s], [e, n]];
}

// ===== Build match expression for fill-color by region =====
function buildColorExpr() {
  const entries = [];
  for (const [id, info] of Object.entries(provinceMap)) {
    entries.push(id, regionColors[info.region]?.fill || '#444');
  }
  return ['match', ['get', 'id'], ...entries, '#444'];
}

// ===== Build label expression: id → name_th =====
function buildLabelExpr() {
  const entries = [];
  for (const [id, info] of Object.entries(provinceMap)) {
    entries.push(id, info.name_th);
  }
  return ['match', ['get', 'id'], ...entries, ''];
}

// ===== Point-in-polygon (ray casting) =====
function pointInPoly(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// ===== Generate random lng/lat points inside a GeoJSON polygon =====
function generateDotsInFeature(feature, n, minDistDeg = 0.03) {
  const coords = feature.geometry.coordinates;
  const rings = feature.geometry.type === 'MultiPolygon'
    ? coords.flatMap((p) => p)
    : coords;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
  }
  let seed = (feature.properties.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 997;
  const rand = () => { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed / 0x7fffffff; };

  const points = [];
  let attempts = 0;
  while (points.length < n && attempts < n * 150) {
    attempts++;
    const px = xMin + rand() * (xMax - xMin);
    const py = yMin + rand() * (yMax - yMin);
    if (!rings.some((ring) => pointInPoly(px, py, ring))) continue;
    if (points.some((p) => Math.hypot(p[0] - px, p[1] - py) < minDistDeg)) continue;
    points.push([px, py]);
  }
  return points;
}

// ===== Compute centroid of a GeoJSON feature =====
function featureCentroid(feature) {
  const coords = feature.geometry.coordinates;
  const ring = feature.geometry.type === 'MultiPolygon' ? coords[0][0] : coords[0];
  let cx = 0, cy = 0;
  for (const [x, y] of ring) { cx += x; cy += y; }
  return [cx / ring.length, cy / ring.length];
}

// ===== Compute bounding box center for a set of features =====
function regionCenter(features) {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const f of features) {
    const coords = f.geometry.coordinates;
    const rings = f.geometry.type === 'MultiPolygon' ? coords.flatMap((p) => p) : coords;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
      }
    }
  }
  return [(xMin + xMax) / 2, (yMin + yMax) / 2];
}

// ===== Animated count-up hook =====
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const step = (now) => {
      const p = Math.min((now - start) / duration, 1);
      setValue(Math.floor((1 - Math.pow(1 - p, 3)) * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

function MapboxMap({ customers = [], viewMode = 'TH', onSetIntl, selectedRegion, selectedProvince, onSelectRegion, onSelectProvince }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const pulseRef = useRef(null);
  const worldGeoCache = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [highlightedId, setHighlightedId] = useState(null);
  const [dotTooltip, setDotTooltip] = useState(null);
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Reset on viewMode change
  const prevMode = useRef(viewMode);
  if (prevMode.current !== viewMode) {
    prevMode.current = viewMode;
    if (selectedCountry) setSelectedCountry(null);
    if (showAll) setShowAll(false);
  }

  // Reset on province change
  const prevProv = useRef(null);
  if (prevProv.current !== selectedProvince) {
    prevProv.current = selectedProvince;
    if (showAll) setShowAll(false);
    if (highlightedId) setHighlightedId(null);
    if (dotTooltip) setDotTooltip(null);
  }

  // Auto-scroll to highlighted card
  useEffect(() => {
    if (highlightedId) {
      const el = document.getElementById(`card-${highlightedId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [highlightedId]);

  // ===== Initialize MapLibre map =====
  useEffect(() => {
    if (mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: THAI_CENTER,
      zoom: INIT_ZOOM,
      pitch: INIT_PITCH,
      bearing: INIT_BEARING,
      antialias: true,
    });

    map.on('load', () => {
      // ===== 3D Buildings from OpenFreeMap (free, no key) =====
      map.addSource('openmaptiles', {
        type: 'vector',
        tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'],
        maxzoom: 14,
      });

      // Dark building extrusions
      map.addLayer({
        id: '3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#1a1014',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.7,
        },
      });

      // Ferrari Red glow on buildings
      map.addLayer({
        id: '3d-buildings-glow',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#FF2800',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.08,
        },
      });

      // ===== Thailand Provinces =====
      map.addSource('provinces', { type: 'geojson', data: thailandGeo });

      // Fill layer
      map.addLayer({
        id: 'provinces-fill',
        type: 'fill',
        source: 'provinces',
        paint: {
          'fill-color': buildColorExpr(),
          'fill-opacity': 0.6,
        },
      });

      // Outline
      map.addLayer({
        id: 'provinces-outline',
        type: 'line',
        source: 'provinces',
        paint: {
          'line-color': '#ffffff',
          'line-width': 0.5,
          'line-opacity': 0.3,
        },
      });

      // Hover outline (thick)
      map.addLayer({
        id: 'provinces-hover',
        type: 'line',
        source: 'provinces',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.5,
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.9, 0],
        },
      });

      // Selected glow (blurred thick line)
      map.addLayer({
        id: 'provinces-selected-glow',
        type: 'line',
        source: 'provinces',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'line-color': '#FF2800',
          'line-width': 6,
          'line-opacity': 0.5,
          'line-blur': 4,
        },
      });

      // Selected outline
      map.addLayer({
        id: 'provinces-selected',
        type: 'line',
        source: 'provinces',
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'line-color': '#ffffff',
          'line-width': 2.5,
          'line-opacity': 0.9,
        },
      });

      // Province labels
      map.addLayer({
        id: 'province-labels',
        type: 'symbol',
        source: 'provinces',
        layout: {
          'text-field': buildLabelExpr(),
          'text-size': ['interpolate', ['linear'], ['zoom'], 5, 8, 8, 12, 12, 16],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-anchor': 'center',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-opacity': 0.85,
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });

      // ===== World country borders (for INTL mode) =====
      map.addSource('world-borders', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Country fill — very subtle
      map.addLayer({
        id: 'world-fill',
        type: 'fill',
        source: 'world-borders',
        paint: {
          'fill-color': '#FF2800',
          'fill-opacity': 0.04,
        },
      });

      // Country border outlines
      map.addLayer({
        id: 'world-outline',
        type: 'line',
        source: 'world-borders',
        paint: {
          'line-color': '#FF2800',
          'line-width': 0.8,
          'line-opacity': 0.3,
        },
      });

      // Highlight border for INTL countries with winners
      map.addLayer({
        id: 'world-highlight',
        type: 'line',
        source: 'world-borders',
        filter: ['==', ['get', 'NAME'], ''],
        paint: {
          'line-color': '#C70039',
          'line-width': 2,
          'line-opacity': 0.7,
        },
      });

      // Highlight fill for INTL countries with winners
      map.addLayer({
        id: 'world-highlight-fill',
        type: 'fill',
        source: 'world-borders',
        filter: ['==', ['get', 'NAME'], ''],
        paint: {
          'fill-color': '#C70039',
          'fill-opacity': 0.12,
        },
      });

      // ===== INTL Country Bubbles =====
      map.addSource('intl-bubbles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Outer glow
      map.addLayer({
        id: 'intl-glow',
        type: 'circle',
        source: 'intl-bubbles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'winnersCount'], 1, 20, 5, 36],
          'circle-color': '#FF2800',
          'circle-opacity': 0.12,
          'circle-blur': 0.6,
        },
      });

      // Bubble fill
      map.addLayer({
        id: 'intl-bubbles-fill',
        type: 'circle',
        source: 'intl-bubbles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'winnersCount'], 1, 10, 5, 22],
          'circle-color': '#C70039',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.85,
        },
      });

      // Country labels
      map.addLayer({
        id: 'intl-labels',
        type: 'symbol',
        source: 'intl-bubbles',
        layout: {
          'text-field': ['get', 'country'],
          'text-size': 12,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-anchor': 'bottom',
          'text-offset': [0, -1.8],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });

      // Winner dots source (empty initially)
      map.addSource('winners', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // Pulse ring layer
      map.addLayer({
        id: 'winners-pulse',
        type: 'circle',
        source: 'winners',
        paint: {
          'circle-radius': 10,
          'circle-color': 'transparent',
          'circle-stroke-color': '#00e5ff',
          'circle-stroke-width': 1.5,
          'circle-stroke-opacity': 0.4,
        },
      });

      // Core dot layer
      map.addLayer({
        id: 'winners-dots',
        type: 'circle',
        source: 'winners',
        paint: {
          'circle-radius': 5,
          'circle-color': '#00e5ff',
          'circle-stroke-color': 'rgba(0,229,255,0.3)',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9,
        },
      });

      // Highlighted dot
      map.addLayer({
        id: 'winners-highlight',
        type: 'circle',
        source: 'winners',
        filter: ['==', ['get', 'cid'], ''],
        paint: {
          'circle-radius': 7,
          'circle-color': '#00ffaa',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 1,
        },
      });

      // ===== Interactions =====
      let hoveredFeatureId = null;

      map.on('mousemove', 'provinces-fill', (e) => {
        if (e.features.length > 0) {
          if (hoveredFeatureId !== null) {
            map.setFeatureState({ source: 'provinces', id: hoveredFeatureId }, { hover: false });
          }
          hoveredFeatureId = e.features[0].id;
          map.setFeatureState({ source: 'provinces', id: hoveredFeatureId }, { hover: true });
          map.getCanvas().style.cursor = 'pointer';
        }
      });

      map.on('mouseleave', 'provinces-fill', () => {
        if (hoveredFeatureId !== null) {
          map.setFeatureState({ source: 'provinces', id: hoveredFeatureId }, { hover: false });
          hoveredFeatureId = null;
        }
        map.getCanvas().style.cursor = '';
      });

      // Winner dot hover
      map.on('mouseenter', 'winners-dots', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'winners-dots', () => {
        map.getCanvas().style.cursor = '';
      });

      // Pulse animation
      let pulseT = 0;
      const animatePulse = () => {
        pulseT += 0.02;
        const s = 1 + 0.8 * Math.sin(pulseT);
        const o = 0.4 * (1 - Math.abs(Math.sin(pulseT)));
        map.setPaintProperty('winners-pulse', 'circle-radius', 6 + s * 6);
        map.setPaintProperty('winners-pulse', 'circle-stroke-opacity', o);
        pulseRef.current = requestAnimationFrame(animatePulse);
      };
      pulseRef.current = requestAnimationFrame(animatePulse);

      mapRef.current = map;
      requestAnimationFrame(() => map.resize());
      setMapReady(true);
    });

    return () => {
      if (pulseRef.current) cancelAnimationFrame(pulseRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ===== Province click handler =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (viewMode === 'INTL') return; // disable province clicks in INTL mode

    const onClick = (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['provinces-fill'] });
      if (features.length > 0) {
        const id = features[0].properties.id;
        const info = provinceMap[id];
        if (info) {
          if (!selectedRegion) onSelectRegion(info.region);
          onSelectProvince(id);
        }
      }
    };
    map.on('click', 'provinces-fill', onClick);
    return () => map.off('click', 'provinces-fill', onClick);
  }, [mapReady, selectedRegion, viewMode, onSelectRegion, onSelectProvince]);

  // ===== Dot click/hover handlers =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onDotMove = (e) => {
      if (e.features.length > 0) {
        const props = e.features[0].properties;
        setHighlightedId(props.cid);
        setDotTooltip({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, name: props.name, amount: Number(props.amount) });
      }
    };
    const onDotLeave = () => { setHighlightedId(null); setDotTooltip(null); };
    const onDotClick = (e) => {
      if (e.features.length > 0) setHighlightedId(e.features[0].properties.cid);
    };

    map.on('mousemove', 'winners-dots', onDotMove);
    map.on('mouseleave', 'winners-dots', onDotLeave);
    map.on('click', 'winners-dots', onDotClick);
    return () => {
      map.off('mousemove', 'winners-dots', onDotMove);
      map.off('mouseleave', 'winners-dots', onDotLeave);
      map.off('click', 'winners-dots', onDotClick);
    };
  }, [mapReady]);

  // ===== React to region/province selection =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // --- Camera ---
    if (selectedProvince) {
      const feature = thailandGeo.features.find((f) => f.properties.id === selectedProvince);
      if (feature) {
        const center = featureCentroid(feature);
        map.easeTo({ center, zoom: 10, pitch: 60, bearing: -15, duration: 900 });
      }
    } else if (selectedRegion) {
      const features = thailandGeo.features.filter((f) => provinceMap[f.properties.id]?.region === selectedRegion);
      if (features.length > 0) {
        const center = regionCenter(features);
        map.easeTo({ center, zoom: 7, pitch: 55, bearing: -20, duration: 800 });
      }
    } else {
      map.easeTo({ center: THAI_CENTER, zoom: INIT_ZOOM, pitch: INIT_PITCH, bearing: INIT_BEARING, duration: 800 });
    }

    // --- Province fill: gray-out non-selected region ---
    if (selectedRegion) {
      const grayExpr = [];
      for (const [id, info] of Object.entries(provinceMap)) {
        grayExpr.push(id, info.region === selectedRegion ? regionColors[info.region].fill : '#D9D9D9');
      }
      map.setPaintProperty('provinces-fill', 'fill-color', ['match', ['get', 'id'], ...grayExpr, '#D9D9D9']);
      map.setPaintProperty('provinces-fill', 'fill-opacity', ['match', ['get', 'id'],
        ...Object.entries(provinceMap).flatMap(([id, info]) =>
          [id, info.region === selectedRegion ? (selectedProvince && selectedProvince !== id ? 0.35 : 0.7) : 0.25]
        ),
        0.25,
      ]);
    } else {
      map.setPaintProperty('provinces-fill', 'fill-color', buildColorExpr());
      map.setPaintProperty('provinces-fill', 'fill-opacity', 0.6);
    }

    // --- Selected province border ---
    if (selectedProvince) {
      map.setFilter('provinces-selected', ['==', ['get', 'id'], selectedProvince]);
      map.setFilter('provinces-selected-glow', ['==', ['get', 'id'], selectedProvince]);
    } else {
      map.setFilter('provinces-selected', ['==', ['get', 'id'], '']);
      map.setFilter('provinces-selected-glow', ['==', ['get', 'id'], '']);
    }

    // --- Label opacity ---
    if (selectedProvince) {
      map.setPaintProperty('province-labels', 'text-opacity', ['case', ['==', ['get', 'id'], selectedProvince], 1, 0.2]);
    } else if (selectedRegion) {
      const regionIds = Object.entries(provinceMap).filter(([, v]) => v.region === selectedRegion).map(([k]) => k);
      map.setPaintProperty('province-labels', 'text-opacity', ['case', ['in', ['get', 'id'], ['literal', regionIds]], 0.9, 0.3]);
    } else {
      map.setPaintProperty('province-labels', 'text-opacity', 0.85);
    }

    // --- Winner dots ---
    if (selectedProvince) {
      const feature = thailandGeo.features.find((f) => f.properties.id === selectedProvince);
      if (feature) {
        const provCustomers = getCustomersByProvince(customers, selectedProvince);
        const dotPositions = generateDotsInFeature(feature, provCustomers.length);
        const dotFeatures = provCustomers.map((c, i) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: dotPositions[i] || featureCentroid(feature) },
          properties: { cid: c.id, name: `${c.name} ${c.surname}`, amount: c.amount },
        }));
        map.getSource('winners').setData({ type: 'FeatureCollection', features: dotFeatures });
      }
    } else {
      map.getSource('winners').setData({ type: 'FeatureCollection', features: [] });
    }
  }, [mapReady, selectedRegion, selectedProvince, customers]);

  // ===== Highlight dot on map when card hovered =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setFilter('winners-highlight', ['==', ['get', 'cid'], highlightedId || '']);
  }, [mapReady, highlightedId]);

  // ===== Overlay panel data =====
  const overlayData = useMemo(() => {
    if (!selectedProvince) return null;
    const provCustomers = getCustomersByProvince(customers, selectedProvince);
    if (provCustomers.length === 0) return null;
    const info = provinceMap[selectedProvince];
    const stats = getProvinceStats(customers, selectedProvince);
    const feature = thailandGeo.features.find((f) => f.properties.id === selectedProvince);
    const centroid = feature ? featureCentroid(feature) : [0, 0];
    const side = centroid[0] < 100.5 ? 'left' : 'right';
    const effectiveMax = showAll ? provCustomers.length : MAX_CARDS;
    const visible = provCustomers.slice(0, effectiveMax);
    const remaining = Math.max(0, provCustomers.length - effectiveMax);
    return {
      side, visible, remaining,
      color: regionColors[info?.region]?.stroke,
      provinceName: info?.name_th,
      totalAmount: stats.totalAmount,
      winnerCount: stats.totalCustomers,
      totalTickets: stats.totalTickets,
    };
  }, [selectedProvince, showAll, customers]);

  const animAmount = useCountUp(overlayData?.totalAmount || 0);
  const animCount = useCountUp(overlayData?.winnerCount || 0, 500);

  // ===== INTL panel data =====
  const intlData = useMemo(() => {
    if (viewMode !== 'INTL') return null;
    const intlCustomers = getIntlCustomers(customers);
    if (intlCustomers.length === 0) return null;
    const stats = getTotalStats(intlCustomers);

    // Group by country (resolve aliases)
    const byCountry = {};
    for (const c of intlCustomers) {
      const raw = c.province || 'Unknown';
      const country = INTL_COUNTRY_ALIAS[raw] || raw;
      if (!byCountry[country]) byCountry[country] = { country, customers: [], tickets: 0, amount: 0, coords: COUNTRY_COORDS[country] || null };
      byCountry[country].customers.push(c);
      byCountry[country].tickets += c.tickets;
      byCountry[country].amount += c.amount;
    }
    const groups = Object.values(byCountry).sort((a, b) => b.amount - a.amount);
    const unmapped = groups.filter((g) => !g.coords);

    // Build GeoJSON for mapped countries
    const geojsonFeatures = groups
      .filter((g) => g.coords)
      .map((g) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: g.coords },
        properties: { country: g.country, winnersCount: g.customers.length, tickets: g.tickets, amount: g.amount },
      }));
    const geojson = { type: 'FeatureCollection', features: geojsonFeatures };

    // Filter visible cards by selectedCountry
    const filtered = selectedCountry
      ? intlCustomers.filter((c) => (INTL_COUNTRY_ALIAS[c.province] || c.province) === selectedCountry)
      : intlCustomers;
    const effectiveMax = showAll ? filtered.length : MAX_CARDS;
    const visible = filtered.slice(0, effectiveMax);
    const remaining = Math.max(0, filtered.length - effectiveMax);

    return { groups, unmapped, geojson, visible, remaining, ...stats };
  }, [viewMode, customers, showAll, selectedCountry]);

  const intlAnimAmount = useCountUp(intlData?.totalAmount || 0);
  const intlAnimCount = useCountUp(intlData?.totalCustomers || 0, 500);

  // ===== INTL: saved overview camera + pending zoom =====
  const intlOverviewCam = useRef({ center: INTL_CENTER, zoom: INTL_ZOOM, pitch: 0, bearing: 0 });
  const pendingZoomRef = useRef(null);

  // ===== INTL: camera + provinces dim (only on viewMode change) =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (viewMode === 'INTL') {
      const cam = { center: INTL_CENTER, zoom: INTL_ZOOM, pitch: 0, bearing: 0, duration: 900, essential: true };
      intlOverviewCam.current = { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing };
      map.easeTo(cam);
      map.setPaintProperty('provinces-fill', 'fill-opacity', 0.15);
      map.setPaintProperty('province-labels', 'text-opacity', 0.15);
    }
  }, [mapReady, viewMode]);

  // ===== INTL: populate bubble + world data (on intlData change) =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;

    if (viewMode === 'INTL' && intlData) {
      map.getSource('intl-bubbles').setData(intlData.geojson);

      // Load world borders (cached after first fetch)
      const loadWorld = async () => {
        if (!worldGeoCache.current) {
          try {
            const res = await fetch('/world.geojson');
            worldGeoCache.current = await res.json();
          } catch { return; }
        }
        if (cancelled) return;
        map.getSource('world-borders').setData(worldGeoCache.current);

        const geoNames = intlData.groups
          .map((g) => COUNTRY_TO_GEO_NAME[g.country] || g.country);
        map.setFilter('world-highlight', ['in', ['get', 'NAME'], ['literal', geoNames]]);
        map.setFilter('world-highlight-fill', ['in', ['get', 'NAME'], ['literal', geoNames]]);
      };
      loadWorld();
    } else {
      map.getSource('intl-bubbles').setData({ type: 'FeatureCollection', features: [] });
      map.getSource('world-borders').setData({ type: 'FeatureCollection', features: [] });
      map.setFilter('world-highlight', ['==', ['get', 'NAME'], '']);
      map.setFilter('world-highlight-fill', ['==', ['get', 'NAME'], '']);
    }

    return () => { cancelled = true; };
  }, [mapReady, viewMode, intlData]);

  // ===== INTL: highlight selected country border =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || viewMode !== 'INTL') return;

    if (selectedCountry) {
      const geoName = COUNTRY_TO_GEO_NAME[selectedCountry] || selectedCountry;
      map.setFilter('world-highlight', ['==', ['get', 'NAME'], geoName]);
      map.setFilter('world-highlight-fill', ['==', ['get', 'NAME'], geoName]);
      map.setPaintProperty('world-highlight', 'line-opacity', 0.9);
      map.setPaintProperty('world-highlight', 'line-width', 2.5);
      map.setPaintProperty('world-highlight-fill', 'fill-opacity', 0.18);
    } else if (intlData) {
      // Show all winner countries
      const geoNames = intlData.groups.map((g) => COUNTRY_TO_GEO_NAME[g.country] || g.country);
      map.setFilter('world-highlight', ['in', ['get', 'NAME'], ['literal', geoNames]]);
      map.setFilter('world-highlight-fill', ['in', ['get', 'NAME'], ['literal', geoNames]]);
      map.setPaintProperty('world-highlight', 'line-opacity', 0.7);
      map.setPaintProperty('world-highlight', 'line-width', 2);
      map.setPaintProperty('world-highlight-fill', 'fill-opacity', 0.12);
    }
  }, [mapReady, viewMode, selectedCountry, intlData]);

  // ===== INTL: zoom helpers =====
  const FIT_OPTS = { padding: 15, duration: 800, pitch: 60, bearing: -25, maxZoom: 9, essential: true };

  const zoomToCountry = useCallback((country, bbox) => {
    const map = mapRef.current;
    if (!map) return;
    if (bbox) {
      map.fitBounds(bbox, FIT_OPTS);
      return;
    }
    // Fallback: try to find the polygon from loaded world data
    if (worldGeoCache.current) {
      const geoName = COUNTRY_TO_GEO_NAME[country] || country;
      const feature = worldGeoCache.current.features.find((f) => f.properties.NAME === geoName);
      if (feature) {
        map.fitBounds(geoBBox(feature), FIT_OPTS);
        return;
      }
    }
    // Last resort: center + zoom
    const coords = COUNTRY_COORDS[country];
    if (coords) {
      map.easeTo({ center: coords, zoom: 7, pitch: 60, bearing: -25, duration: 800, essential: true });
    }
  }, []);

  const zoomToIntlOverview = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const cam = intlOverviewCam.current;
    map.easeTo({ ...cam, duration: 800, essential: true });
  }, []);

  // ===== Execute pending zoom after state update =====
  useEffect(() => {
    const pending = pendingZoomRef.current;
    if (!pending) return;
    pendingZoomRef.current = null;
    if (pending.country) {
      zoomToCountry(pending.country, pending.bbox);
    } else {
      zoomToIntlOverview();
    }
  }, [selectedCountry, zoomToCountry, zoomToIntlOverview]);

  // ===== INTL bubble interactions =====
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; setDotTooltip(null); };
    const onMove = (e) => {
      if (e.features.length > 0) {
        const p = e.features[0].properties;
        setDotTooltip({
          x: e.originalEvent.clientX,
          y: e.originalEvent.clientY,
          name: p.country,
          amount: Number(p.amount),
          extra: `${p.winnersCount} คน · ${p.tickets} ใบ`,
        });
      }
    };
    const onBubbleClick = (e) => {
      if (e.features.length > 0) {
        const country = e.features[0].properties.country;
        setSelectedCountry((prev) => {
          const next = prev === country ? null : country;
          pendingZoomRef.current = { country: next, bbox: null };
          return next;
        });
        setShowAll(false);
      }
    };

    // Click on world country polygon
    const onWorldClick = (e) => {
      if (e.features.length > 0) {
        const feature = e.features[0];
        const geoName = feature.properties.NAME;
        const country = GEO_NAME_TO_COUNTRY[geoName] || geoName;
        if (!COUNTRY_COORDS[country]) return;
        const bbox = geoBBox(feature);
        setSelectedCountry((prev) => {
          const next = prev === country ? null : country;
          pendingZoomRef.current = { country: next, bbox };
          return next;
        });
        setShowAll(false);
      }
    };

    map.on('mouseenter', 'intl-bubbles-fill', onEnter);
    map.on('mouseleave', 'intl-bubbles-fill', onLeave);
    map.on('mousemove', 'intl-bubbles-fill', onMove);
    map.on('click', 'intl-bubbles-fill', onBubbleClick);
    map.on('click', 'world-fill', onWorldClick);
    map.on('click', 'world-highlight-fill', onWorldClick);
    return () => {
      map.off('mouseenter', 'intl-bubbles-fill', onEnter);
      map.off('mouseleave', 'intl-bubbles-fill', onLeave);
      map.off('mousemove', 'intl-bubbles-fill', onMove);
      map.off('click', 'intl-bubbles-fill', onBubbleClick);
      map.off('click', 'world-fill', onWorldClick);
      map.off('click', 'world-highlight-fill', onWorldClick);
    };
  }, [mapReady, zoomToCountry, zoomToIntlOverview]);

  // Region buttons
  const regionButtons = useMemo(() => [
    { id: null, label: 'ทั้งหมด' },
    ...Object.entries(regionColors).map(([id, v]) => ({ id, label: v.label })),
  ], []);

  const handleRegionBtn = useCallback((id) => {
    onSelectRegion(id);
    onSelectProvince(null);
    setShowAll(false);
  }, [onSelectRegion, onSelectProvince]);

  return (
    <div className="map-container">
      {/* Region bar */}
      <div className="region-bar">
        {regionButtons.map((btn) => {
          const isActive = viewMode === 'TH' && btn.id === selectedRegion;
          const color = btn.id ? regionColors[btn.id]?.stroke : '#FF2800';
          return (
            <button
              key={btn.id || 'all'}
              className={`region-btn ${isActive ? 'active' : ''}`}
              style={isActive ? { background: color, borderColor: color, color: '#fff' } : { borderColor: color, color }}
              onClick={() => handleRegionBtn(btn.id)}
            >
              {btn.label}
            </button>
          );
        })}
        <button
          className={`region-btn intl-btn ${viewMode === 'INTL' ? 'active' : ''}`}
          style={viewMode === 'INTL'
            ? { background: '#C70039', borderColor: '#C70039', color: '#fff' }
            : { borderColor: '#C70039', color: '#C70039' }}
          onClick={() => {
            if (viewMode === 'INTL' && selectedCountry) {
              // Already in INTL with country selected → go back to overview
              pendingZoomRef.current = { country: null, bbox: null };
              setSelectedCountry(null);
              setShowAll(false);
            } else {
              onSetIntl();
            }
          }}
        >
          ต่างประเทศ
        </button>
      </div>

      {/* Map container — wrapper for absolute sizing */}
      <div className="mapbox-wrapper">
        <div ref={containerRef} className="mapbox-canvas" />
      </div>

      {/* HUD scanline overlay */}
      <div className="hud-scanlines" />


      {/* Overlay card panel */}
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

      {/* INTL overlay panel */}
      {intlData && viewMode === 'INTL' && (
        <div className="overlay-panel overlay-right" style={{ borderColor: '#C70039' }}>
          <div className="overlay-header">
            <div className="overlay-title" style={{ color: '#C70039' }}>
              {selectedCountry || 'ต่างประเทศ'}
            </div>
            <div className="overlay-stats-row">
              <span className="overlay-stat-item">
                <span className="overlay-stat-value" style={{ color: '#C70039' }}>{intlAnimCount}</span>
                <span className="overlay-stat-label">คน</span>
              </span>
              <span className="overlay-stat-item">
                <span className="overlay-stat-value neon-green">฿{intlAnimAmount.toLocaleString('th-TH')}</span>
                <span className="overlay-stat-label">ยอดรวม</span>
              </span>
            </div>
          </div>

          {/* Clear country filter */}
          {selectedCountry && (
            <button className="intl-clear-filter-btn" onClick={() => { pendingZoomRef.current = { country: null, bbox: null }; setSelectedCountry(null); setShowAll(false); }}>
              ดูทุกประเทศ
            </button>
          )}

          {/* Country group summary */}
          {!selectedCountry && (
            <div className="intl-groups">
              {intlData.groups.map((g) => (
                <div
                  key={g.country}
                  className={`intl-group-item ${selectedCountry === g.country ? 'intl-group-active' : ''}`}
                  style={{ cursor: g.coords ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (!g.coords) return;
                    setSelectedCountry((prev) => {
                      const next = prev === g.country ? null : g.country;
                      pendingZoomRef.current = { country: next, bbox: null };
                      return next;
                    });
                    setShowAll(false);
                  }}
                >
                  <div className="intl-group-name">{g.country}{!g.coords ? ' *' : ''}</div>
                  <div className="intl-group-stats">
                    <span>{g.customers.length} คน</span>
                    <span>{g.tickets} ใบ</span>
                    <span className="neon-green">฿{g.amount.toLocaleString('th-TH')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Individual cards */}
          <div className="overlay-cards">
            {intlData.visible.map((c, i) => (
              <div
                key={c.id}
                className="overlay-card"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <img
                  className="overlay-avatar"
                  src={c.avatar}
                  alt={c.name}
                  onError={(e) => {
                    e.target.src = `https://ui-avatars.com/api/?name=${c.name}&background=0d1528&color=C70039&size=100`;
                  }}
                />
                <div className="overlay-body">
                  <div className="overlay-name">{c.name} {c.surname}</div>
                  <div className="overlay-meta">
                    <span className="oc-badge tickets">{c.tickets} ใบ</span>
                    <span className="oc-badge money">฿{c.amount.toLocaleString('th-TH')}</span>
                  </div>
                  <div className="intl-country-tag">{INTL_COUNTRY_ALIAS[c.province] || c.province}</div>
                </div>
              </div>
            ))}
          </div>
          {intlData.remaining > 0 && (
            <button className="overlay-more-btn" onClick={() => setShowAll(true)}>
              +{intlData.remaining} ดูทั้งหมด
            </button>
          )}
        </div>
      )}

      {/* Dot tooltip */}
      {dotTooltip && (
        <div className="dot-tooltip" style={{ left: dotTooltip.x + 16, top: dotTooltip.y - 10 }}>
          <div className="dot-tooltip-name">{dotTooltip.name}</div>
          {dotTooltip.extra && <div className="dot-tooltip-extra">{dotTooltip.extra}</div>}
          <div className="dot-tooltip-amount">฿{dotTooltip.amount.toLocaleString('th-TH')}</div>
        </div>
      )}
    </div>
  );
}

export default MapboxMap;
