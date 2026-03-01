import { getTotalStats } from '../data/prizeData';

function Header({ customers = [] }) {
  const stats = getTotalStats(customers);

  const formatMoney = (amount) => {
    return amount.toLocaleString('th-TH');
  };

  return (
    <header className="header">
      <div className="header-logo">
        <div className="logo-circle">
          <span>FT</span>
        </div>
        <span className="logo-text">Smart Data Intelligence</span>
      </div>
      <div className="header-stats">
        <div className="stat-card">
          <div className="stat-value">4 ปี 8 เดือน 12 วัน</div>
          <div className="stat-label">Company Age</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatMoney(stats.totalAmount)}</div>
          <div className="stat-label">ยอดรวม (บาท)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalCustomers}</div>
          <div className="stat-label">จำนวนลูกค้า</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalTickets}</div>
          <div className="stat-label">จำนวนใบทั้งหมด</div>
        </div>
      </div>
    </header>
  );
}

export default Header;
