export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result;
}
export function addDays(key, count) {
  const date = parseDate(key);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}
export function mondayOf(key) {
  const date = parseDate(key);
  return addDays(key, -((date.getDay() + 6) % 7));
}
export function isoWeek(key) {
  const date = parseDate(mondayOf(key));
  date.setDate(date.getDate() + 3);
  const year = date.getFullYear();
  const firstMonday = mondayOf(`${year}-01-04`);
  // UTC noon keeps the week count independent of daylight saving changes.
  const week = Math.round((Date.parse(`${mondayOf(key)}T12:00:00Z`) - Date.parse(`${firstMonday}T12:00:00Z`)) / (7 * 86400000)) + 1;
  return { year, week };
}
export function monthGrid(year, month) {
  const first = new Date(0);
  first.setFullYear(year, month, 1);
  first.setHours(12, 0, 0, 0);
  const start = mondayOf(dateKey(first));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}
