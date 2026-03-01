import { provinceMap, regionColors } from './provinceMapping';

// ===== Regions (static — same as before) =====
const regionKeys = ['north', 'northeast', 'central', 'east', 'west', 'south'];

export const regions = regionKeys.map((key) => {
  const color = regionColors[key];
  const provinces = Object.entries(provinceMap)
    .filter(([, v]) => v.region === key)
    .map(([id, v]) => ({ id, name: v.name_th }));
  return { id: key, name: color.label, color: color.stroke, provinces };
});

export function getRegionById(regionId) {
  return regions.find((r) => r.id === regionId);
}

// ===== Reverse map: Thai province name → ISO code =====
const nameToId = {};
for (const [id, info] of Object.entries(provinceMap)) {
  nameToId[info.name_th] = id;
}

// ===== CSV Loader =====
export async function loadPrizeData() {
  try {
    const res = await fetch('/prize.csv');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    let text = await res.text();

    // Strip BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error('CSV is empty');

    // Skip header (line 0)
    const customers = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 7) continue;

      const drawDate = cols[0].trim();
      const memberId = cols[1].trim();
      const fullName = cols[2].trim();
      const type = cols[3].trim();           // TH or INTL
      const province = cols[4].trim();
      const tickets = parseInt(cols[5].trim(), 10) || 0;
      const amount = parseInt(cols[6].trim(), 10) || 0;

      // Split name by first space
      const spaceIdx = fullName.indexOf(' ');
      const firstName = spaceIdx > 0 ? fullName.slice(0, spaceIdx) : fullName;
      const surname = spaceIdx > 0 ? fullName.slice(spaceIdx + 1) : '';

      // Province matching: only TH records that match a known Thai province
      const provinceId = type === 'TH' ? (nameToId[province] || null) : null;

      customers.push({
        id: memberId && memberId !== 'null' ? memberId : `ROW${i}`,
        name: firstName,
        surname,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(firstName)}&background=0d1528&color=FF2800&size=100`,
        provinceId,
        tickets,
        amount,
        type,
        drawDate,
        province,   // raw province/country name for display
      });
    }

    return { customers, error: null };
  } catch (err) {
    return { customers: [], error: `โหลดข้อมูลไม่สำเร็จ: ${err.message}` };
  }
}

// ===== Helper functions (take customers array as first param) =====

export function getCustomersByProvince(customers, provinceId) {
  return customers.filter((c) => c.provinceId === provinceId);
}

export function getIntlCustomers(customers) {
  return customers.filter((c) => c.type === 'INTL' || c.provinceId === null);
}

export function getProvinceStats(customers, provinceId) {
  const pc = getCustomersByProvince(customers, provinceId);
  return {
    totalCustomers: pc.length,
    totalAmount: pc.reduce((s, c) => s + c.amount, 0),
    totalTickets: pc.reduce((s, c) => s + c.tickets, 0),
  };
}

export function getRegionStats(customers, regionId) {
  const region = getRegionById(regionId);
  if (!region) return { totalCustomers: 0, totalAmount: 0, totalTickets: 0 };
  const rc = region.provinces.flatMap((p) =>
    customers.filter((c) => c.provinceId === p.id)
  );
  return {
    totalCustomers: rc.length,
    totalAmount: rc.reduce((s, c) => s + c.amount, 0),
    totalTickets: rc.reduce((s, c) => s + c.tickets, 0),
  };
}

export function getTotalStats(customers) {
  return {
    totalCustomers: customers.length,
    totalAmount: customers.reduce((s, c) => s + c.amount, 0),
    totalTickets: customers.reduce((s, c) => s + c.tickets, 0),
  };
}
