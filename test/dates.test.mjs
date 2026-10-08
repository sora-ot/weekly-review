import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, parseDate, addDays, mondayOf, isoWeek, monthGrid } from '../public/dates.js';

test('周一至周日属于同一周', () => {
  for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']) {
    assert.equal(mondayOf(day), '2026-10-05');
    assert.deepEqual(isoWeek(day), { year: 2026, week: 41 });
  }
});
test('跨年周使用正确的 ISO 周年', () => {
  assert.deepEqual(isoWeek('2021-01-01'), { year: 2020, week: 53 });
  assert.deepEqual(isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(isoWeek('2026-12-31'), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek('2027-01-03'), { year: 2026, week: 53 });
});
test('闰年和跨月日期连续', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-12-28', 6), '2027-01-03');
  assert.equal(dateKey(parseDate('2026-10-08')), '2026-10-08');
});
test('月历包含完整的六周，周一开头，周日结尾', () => {
  const grid = monthGrid(2026, 9);
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-09-28');
  assert.equal(grid[41], '2026-11-08');
  assert.equal(parseDate(grid[0]).getDay(), 1);
  assert.equal(parseDate(grid[41]).getDay(), 0);
  assert.equal(new Set(grid).size, 42);
});
test('周数在夏令时切换附近连续', () => {
  assert.equal(isoWeek('2026-03-09').week - isoWeek('2026-03-02').week, 1);
  assert.equal(isoWeek('2026-11-02').week - isoWeek('2026-10-26').week, 1);
});
