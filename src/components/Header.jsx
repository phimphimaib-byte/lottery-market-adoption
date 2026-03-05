import { useState, useEffect, useMemo } from 'react';
import { getTotalStats, getRegionById } from '../data/prizeData';
import { provinceMap } from '../data/provinceMapping';

const TZ = 'Asia/Bangkok';
const START = { y: 2021, m: 9, d: 29 };

function getBangkokYMD(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { y: Number(map.year), m: Number(map.month), d: Number(map.day) };
}

function daysSinceStartBangkok(todayYMD) {
  const startUTC = Date.UTC(START.y, START.m - 1, START.d);
  const todayUTC = Date.UTC(todayYMD.y, todayYMD.m - 1, todayYMD.d);
  return Math.floor((todayUTC - startUTC) / 86400000);
}

function getCompanyAge(now = new Date()) {
  const t = getBangkokYMD(now);
  const dayNumber = daysSinceStartBangkok(t) + 1;
  let years = t.y - START.y;
  let months = t.m - START.m;
  let days = t.d - START.d;
  if (days < 0) {
    const lastDayPrevMonth = new Date(Date.UTC(t.y, t.m - 1, 0)).getUTCDate();
    days += lastDayPrevMonth;
    months -= 1;
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  return { years, months, days, dayNumber };
}

function Header({ customers = [], viewMode = 'TH', selectedRegion = null }) {
  const filtered = useMemo(() => {
    if (viewMode === 'INTL') {
      return customers.filter((c) => c.type === 'INTL' || c.provinceId === null);
    }
    if (selectedRegion) {
      const region = getRegionById(selectedRegion);
      if (region) {
        const regionIds = new Set(region.provinces.map((p) => p.id));
        return customers.filter((c) => regionIds.has(c.provinceId));
      }
    }
    return customers;
  }, [customers, viewMode, selectedRegion]);

  const stats = getTotalStats(filtered);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { years, months, days, dayNumber } = getCompanyAge(now);

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
          <div className="stat-value">{years} ปี {months} เดือน {days} วัน</div>
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
