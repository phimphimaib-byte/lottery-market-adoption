import { provinceMap, regionColors } from './provinceMapping';

// สร้าง regions จาก provinceMap
const regionKeys = ['north', 'northeast', 'central', 'east', 'west', 'south'];

export const regions = regionKeys.map((key) => {
  const color = regionColors[key];
  const provinces = Object.entries(provinceMap)
    .filter(([, v]) => v.region === key)
    .map(([id, v]) => ({ id, name: v.name_th }));
  return { id: key, name: color.label, color: color.stroke, provinces };
});

// ชื่อจำลอง
const firstNames = [
  'สมชาย','สมหญิง','ประเสริฐ','สุดา','วิชัย','นภา','ธนา','พรทิพย์','อนุชา','ศิริพร',
  'กิตติ','มาลี','วรพจน์','จันทร์เพ็ญ','ภาณุ','รัตนา','ชัยวัฒน์','อรทัย','เจษฎา','ปิยะ',
  'สุภาพร','วันชัย','นิตยา','พิชัย','กัญญา','ธีรพงศ์','ลัดดา','อภิชาต','สาวิตรี','ณัฐพล',
];
const lastNames = [
  'วงศ์สวัสดิ์','แก้วมณี','ศรีสุวรรณ','พงศ์พิพัฒน์','จันทร์เจริญ',
  'สุขสมบูรณ์','ทองดี','เจริญผล','บุญมี','รุ่งเรือง',
  'สมบูรณ์','พิทักษ์','ประสิทธิ์','มั่นคง','ศรีวิชัย',
  'สกุลดี','พัฒนา','อารีย์','เกษม','ชัยชนะ',
];

let customerId = 1;
function seededRandom(seed) {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateCustomers(provinceId, seed) {
  const count = Math.floor(seededRandom(seed) * 4) + 2;
  const customers = [];
  for (let i = 0; i < count; i++) {
    const s = seed * 100 + i;
    const firstName = firstNames[Math.floor(seededRandom(s + 1) * firstNames.length)];
    const lastName = lastNames[Math.floor(seededRandom(s + 2) * lastNames.length)];
    const tickets = Math.floor(seededRandom(s + 3) * 10) + 1;
    const amount = (Math.floor(seededRandom(s + 4) * 500) + 50) * 1000;
    customers.push({
      id: `C${String(customerId++).padStart(5, '0')}`,
      name: firstName,
      surname: lastName,
      avatar: `https://i.pravatar.cc/150?img=${(customerId % 70) + 1}`,
      provinceId,
      tickets,
      amount,
    });
  }
  return customers;
}

export const customers = [];
let seedCounter = 1;
regions.forEach((region) => {
  region.provinces.forEach((province) => {
    const provinceCustomers = generateCustomers(province.id, seedCounter++);
    customers.push(...provinceCustomers);
  });
});

// Helpers
export function getCustomersByProvince(provinceId) {
  return customers.filter((c) => c.provinceId === provinceId);
}

export function getRegionById(regionId) {
  return regions.find((r) => r.id === regionId);
}

export function getProvinceById(regionId, provinceId) {
  const region = getRegionById(regionId);
  if (!region) return null;
  return region.provinces.find((p) => p.id === provinceId);
}

export function getRegionStats(regionId) {
  const region = getRegionById(regionId);
  if (!region) return { totalCustomers: 0, totalAmount: 0, totalTickets: 0 };
  const rc = region.provinces.flatMap((p) => customers.filter((c) => c.provinceId === p.id));
  return {
    totalCustomers: rc.length,
    totalAmount: rc.reduce((s, c) => s + c.amount, 0),
    totalTickets: rc.reduce((s, c) => s + c.tickets, 0),
  };
}

export function getProvinceStats(provinceId) {
  const pc = getCustomersByProvince(provinceId);
  return {
    totalCustomers: pc.length,
    totalAmount: pc.reduce((s, c) => s + c.amount, 0),
    totalTickets: pc.reduce((s, c) => s + c.tickets, 0),
  };
}

export function getTotalStats() {
  return {
    totalCustomers: customers.length,
    totalAmount: customers.reduce((s, c) => s + c.amount, 0),
    totalTickets: customers.reduce((s, c) => s + c.tickets, 0),
  };
}
