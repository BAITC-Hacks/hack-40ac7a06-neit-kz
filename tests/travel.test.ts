import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { META } from '../lib/catalog';
import { computeTravel, estimateTravelCost, TRAVEL_SNAPSHOT, type FlightSnapshot } from '../lib/travel';

test('точная дата из снимка: сумма складывается из двух разных плеч', () => {
  const t = estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Ведущий')!;
  assert.equal(t.basis, 'exact');
  // 24 900 (ALA→NQZ) + 26 400 (NQZ→ALA) — именно два разных плеча, а не удвоенное одно
  assert.equal(t.perPersonKzt, 51_300);
  assert.notEqual(t.perPersonKzt, 24_900 * 2);
  assert.notEqual(t.perPersonKzt, 26_400 * 2);
  assert.equal(t.headcount, 1);
  assert.equal(t.totalKzt, 51_300);
});

test('лайв-бэнд стоит ровно впятеро дороже ведущего на той же дате', () => {
  const host = estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Ведущий')!;
  const band = estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Лайв-бэнд')!;
  assert.equal(band.headcount, 5);
  assert.equal(band.totalKzt, host.totalKzt * 5);
  assert.equal(band.totalKzt, 256_500);
});

test('дата в двух днях от имеющейся берётся как ближайшая', () => {
  const t = estimateTravelCost('Алматы', 'Астана', '2026-09-27', 'Ведущий')!;
  assert.equal(t.basis, 'nearby');
});

test('вокруг даты пусто — работает медиана месяца', () => {
  const t = estimateTravelCost('Алматы', 'Астана', '2026-11-14', 'Ведущий')!;
  assert.equal(t.basis, 'median');
  assert.equal(t.perPersonKzt, 28_300 + 28_500);
});

test('плечи с разным исходом: в basis попадает худший', () => {
  const snapshot: FlightSnapshot = {
    ...TRAVEL_SNAPSHOT,
    routes: {
      'ALA-NQZ': { '2026-10-05': 20_000 },
      'NQZ-ALA': {},
    },
  };
  const t = computeTravel(snapshot, 'Алматы', 'Астана', '2026-10-05', 'Ведущий')!;
  // туда — точная цена, обратно — только медиана: худший исход побеждает
  assert.equal(t.basis, 'median');
  assert.equal(t.perPersonKzt, 20_000 + 29_800);
});

test('категория вне таблицы состава не считается вовсе', () => {
  assert.equal(estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Танцевальный коллектив'), undefined);
  assert.equal(estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Декоратор'), undefined);
});

test('«Зарубежье» маршрута не имеет', () => {
  assert.ok(META.cities.includes('Зарубежье'));
  assert.equal(estimateTravelCost('Зарубежье', 'Астана', '2026-09-25', 'Ведущий'), undefined);
  assert.equal(estimateTravelCost('Алматы', 'Зарубежье', '2026-09-25', 'Ведущий'), undefined);
});

test('один и тот же город не считается перелётом', () => {
  assert.equal(estimateTravelCost('Алматы', 'Алматы', '2026-09-25', 'Ведущий'), undefined);
});

test('результат не зависит от системного времени', () => {
  const first = estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Лайв-бэнд');
  const real = Date.now;
  try {
    Date.now = () => new Date('2027-05-01T00:00:00Z').getTime();
    assert.deepEqual(estimateTravelCost('Алматы', 'Астана', '2026-09-25', 'Лайв-бэнд'), first);
  } finally {
    Date.now = real;
  }
});

test('снимок не содержит дат вне окна каталога', () => {
  for (const [route, days] of Object.entries(TRAVEL_SNAPSHOT.routes)) {
    for (const day of Object.keys(days)) {
      assert.ok(
        day >= META.dateWindow.from && day <= META.dateWindow.to,
        `${route}: дата ${day} вне окна каталога`,
      );
    }
  }
});
