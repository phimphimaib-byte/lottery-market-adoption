import { useState } from 'react';
import { getRegionById, getProvinceStats, getCustomersByProvince } from '../data/mockData';

function ProvinceList({ regionId }) {
  const [expandedProvince, setExpandedProvince] = useState(null);
  const region = getRegionById(regionId);
  if (!region) return null;

  const toggleProvince = (provinceId) => {
    setExpandedProvince((prev) => (prev === provinceId ? null : provinceId));
  };

  return (
    <div className="province-list">
      <h2 className="section-title">{region.name} — เลือกจังหวัด</h2>
      <div className="province-stack">
        {region.provinces.map((province) => {
          const stats = getProvinceStats(province.id);
          const isExpanded = expandedProvince === province.id;
          const customers = isExpanded ? getCustomersByProvince(province.id) : [];

          return (
            <div key={province.id} className={`province-item ${isExpanded ? 'expanded' : ''}`}>
              <div className="province-card" onClick={() => toggleProvince(province.id)}>
                <div className="province-card-header">
                  <h3>{province.name}</h3>
                  <span className={`province-arrow ${isExpanded ? 'open' : ''}`}>
                    {isExpanded ? '▼' : '→'}
                  </span>
                </div>
                <div className="province-card-stats">
                  <span>{stats.totalCustomers} ลูกค้า</span>
                  <span>{stats.totalTickets} ใบ</span>
                  <span>{stats.totalAmount.toLocaleString('th-TH')} ฿</span>
                </div>
              </div>

              {isExpanded && (
                <div className="province-customers">
                  <div className="customer-grid">
                    {customers.map((customer) => (
                      <div key={customer.id} className="customer-card">
                        <div className="customer-avatar">
                          <img
                            src={customer.avatar}
                            alt={`${customer.name} ${customer.surname}`}
                            onError={(e) => {
                              e.target.src = `https://ui-avatars.com/api/?name=${customer.name}+${customer.surname}&background=0d1528&color=00c8ff&size=150`;
                            }}
                          />
                        </div>
                        <div className="customer-info">
                          <div className="customer-id">{customer.id}</div>
                          <div className="customer-name">
                            {customer.name} {customer.surname}
                          </div>
                          <div className="customer-details">
                            <div className="customer-detail">
                              <span className="detail-value">{customer.tickets} ใบ</span>
                            </div>
                            <div className="customer-detail">
                              <span className="detail-value">{customer.amount.toLocaleString('th-TH')} บาท</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProvinceList;
