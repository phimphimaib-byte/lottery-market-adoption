import { useState, useCallback, useEffect } from 'react';
import Header from './components/Header';
import Breadcrumb from './components/Breadcrumb';
import MapboxMap from './components/MapboxMap';
import { getRegionById, loadPrizeData } from './data/prizeData';
import { provinceMap } from './data/provinceMapping';
import './App.css';

function App() {
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [selectedProvince, setSelectedProvince] = useState(null);
  const [viewMode, setViewMode] = useState('TH'); // 'TH' | 'INTL'

  // Async data loading
  const [customers, setCustomers] = useState([]);
  const [dataError, setDataError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPrizeData().then(({ customers: data, error }) => {
      setCustomers(data);
      if (error) setDataError(error);
      setLoading(false);
    });
  }, []);

  const handleSelectRegion = useCallback((regionId) => {
    setViewMode('TH');
    setSelectedRegion((prev) => (prev === regionId ? null : regionId));
    setSelectedProvince(null);
  }, []);

  const handleSelectProvince = useCallback((provinceId) => {
    if (provinceId === null) {
      setSelectedProvince(null);
      return;
    }
    const info = provinceMap[provinceId];
    if (info) {
      setSelectedRegion(info.region);
      setSelectedProvince(provinceId);
    }
  }, []);

  const handleSetIntl = useCallback(() => {
    setViewMode('INTL');
    setSelectedRegion(null);
    setSelectedProvince(null);
  }, []);

  const goHome = () => { setViewMode('TH'); setSelectedRegion(null); setSelectedProvince(null); };
  const goToRegion = () => { setSelectedProvince(null); };

  // Breadcrumb
  const breadcrumbItems = [
    { label: 'หน้าแรก', onClick: (selectedRegion || selectedProvince || viewMode === 'INTL') ? goHome : null },
  ];
  if (viewMode === 'INTL') {
    breadcrumbItems.push({ label: 'ต่างประเทศ', onClick: null });
  } else if (selectedRegion) {
    const region = getRegionById(selectedRegion);
    breadcrumbItems.push({ label: region?.name || '', onClick: selectedProvince ? goToRegion : null });
    if (selectedProvince) {
      const info = provinceMap[selectedProvince];
      breadcrumbItems.push({ label: info?.name_th || '', onClick: null });
    }
  }

  return (
    <div className="app">
      <Header customers={customers} />
      {dataError && (
        <div className="error-banner">{dataError}</div>
      )}
      <div className="breadcrumb-bar">
        <Breadcrumb items={breadcrumbItems} />
      </div>
      {loading ? (
        <div className="loading-overlay">กำลังโหลดข้อมูล...</div>
      ) : (
        <div className="map-fullscreen">
          <MapboxMap
            customers={customers}
            viewMode={viewMode}
            onSetIntl={handleSetIntl}
            selectedRegion={selectedRegion}
            selectedProvince={selectedProvince}
            onSelectRegion={handleSelectRegion}
            onSelectProvince={handleSelectProvince}
          />
        </div>
      )}
    </div>
  );
}

export default App;
