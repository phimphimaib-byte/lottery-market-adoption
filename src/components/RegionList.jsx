import { regions, getRegionStats } from '../data/mockData';

function RegionList({ onSelectRegion }) {
  return (
    <div className="region-list">
      <h2 className="section-title">เลือกภาค</h2>
      <div className="region-grid">
        {regions.map((region) => {
          const stats = getRegionStats(region.id);
          return (
            <div
              key={region.id}
              className="region-card"
              onClick={() => onSelectRegion(region.id)}
              style={{ borderLeftColor: region.color }}
            >
              <div className="region-card-header">
                <h3>{region.name}</h3>
                <span className="region-arrow">→</span>
              </div>
              <div className="region-card-stats">
                <div className="mini-stat">
                  <span className="mini-stat-value">{stats.totalCustomers}</span>
                  <span className="mini-stat-label">ลูกค้า</span>
                </div>
                <div className="mini-stat">
                  <span className="mini-stat-value">{stats.totalTickets}</span>
                  <span className="mini-stat-label">ใบ</span>
                </div>
                <div className="mini-stat">
                  <span className="mini-stat-value">{stats.totalAmount.toLocaleString('th-TH')}</span>
                  <span className="mini-stat-label">บาท</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RegionList;
