import { getCustomersByProvince } from '../data/mockData';

function CustomerList({ provinceId, provinceName }) {
  const customers = getCustomersByProvince(provinceId);

  return (
    <div className="customer-panel">
      <h2 className="section-title">ผู้ถูกรางวัล — {provinceName}</h2>
      <div className="customer-summary">
        รวม <b>{customers.length}</b> คน | <b>{customers.reduce((s, c) => s + c.tickets, 0)}</b> ใบ | <b>฿{customers.reduce((s, c) => s + c.amount, 0).toLocaleString('th-TH')}</b>
      </div>
      <div className="customer-list">
        {customers.map((c) => (
          <div key={c.id} className="customer-card">
            <div className="customer-avatar">
              <img
                src={c.avatar}
                alt={`${c.name} ${c.surname}`}
                onError={(e) => {
                  e.target.src = `https://ui-avatars.com/api/?name=${c.name}+${c.surname}&background=0d1528&color=00c8ff&size=150`;
                }}
              />
            </div>
            <div className="customer-info">
              <div className="customer-id">{c.id}</div>
              <div className="customer-name">{c.name} {c.surname}</div>
              <div className="customer-meta">
                <span className="meta-tag tickets">{c.tickets} ใบ</span>
                <span className="meta-tag money">฿{c.amount.toLocaleString('th-TH')}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CustomerList;
