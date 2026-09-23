import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CONTRACTORS } from '../lib/catalog';
import { applyFilters } from '../lib/filters';
import { match } from '../lib/match';
import { assignDifferentiators } from '../lib/differentiators';
import scenarios from '../data/scenarios.json';
import type { MatchRequest } from '../lib/types';

type Scenario = { id: string; title: string; req: MatchRequest };
const SCENARIOS = scenarios as Scenario[];
const req = (id: string) => SCENARIOS.find((s) => s.id === id)!.req;

test('детерминизм: три прогона подряд дают идентичный результат', () => {
  for (const s of SCENARIOS) {
    const runs = [1, 2, 3].map(() => JSON.stringify({ ...match(s.req), timings: null }));
    assert.equal(runs[0], runs[1], `${s.id}: прогоны 1 и 2 разошлись`);
    assert.equal(runs[1], runs[2], `${s.id}: прогоны 2 и 3 разошлись`);
  }
});

test('детерминизм не зависит от модели: порядок карточек задаётся кодом', () => {
  // match() вообще не обращается к модели — объяснения добавляются слоем выше.
  for (const s of SCENARIOS) {
    const ids = match(s.req).cards.map((c) => c.id);
    const again = match(s.req).cards.map((c) => c.id);
    assert.deepEqual(ids, again, `${s.id}: порядок карточек нестабилен`);
  }
});

test('на экране не больше трёх карточек с учётом послаблений и ближайших', () => {
  for (const s of SCENARIOS) {
    const r = match(s.req);
    const total = r.cards.length + r.softCards.length + r.nearestCards.length;
    assert.ok(total <= 3, `${s.id}: на экране ${total} карточек`);
  }
});

test('занятый на дату не попадает в основную выдачу', () => {
  for (const s of SCENARIOS) {
    const r = match(s.req);
    for (const card of r.cards) {
      const c = CONTRACTORS.find((x) => x.id === card.id)!;
      assert.ok(!c.busyDates.includes(s.req.date), `${s.id}: ${c.name} занят ${s.req.date}, но показан`);
    }
  }
});

test('пустой max_hours проходит фильтр длительности (флорист, декоратор, сувениры)', () => {
  const noLimit = CONTRACTORS.filter((c) => c.maxHours === null);
  assert.equal(noLimit.length, 9, 'в датасете должно быть 9 профилей без лимита часов');

  const r = applyFilters({
    city: 'Алматы',
    category: 'Флорист',
    eventFormat: 'свадьба',
    date: '2026-10-12',
    durationHours: 12,
  });
  assert.ok(r.survivors.length > 0, 'фильтр длительности не должен обнулять категории без лимита часов');
});

test('даты сравниваются строками: граница месяца не уезжает', () => {
  // Если где-то появится new Date('2026-11-01'), тест на границе месяца это поймает.
  const c = CONTRACTORS.find((x) => x.busyDates.some((d) => d.endsWith('-01')))!;
  const busyFirst = c.busyDates.find((d) => d.endsWith('-01'))!;
  const r = applyFilters({ city: c.city, category: c.categories[0], date: busyFirst });
  assert.ok(!r.survivors.some((x) => x.id === c.id), `${c.name} занят ${busyFirst}, но прошёл фильтр`);
});

test('язык жёсткий только там, где продукт — речь и вокал', () => {
  // У декораторов нет ни одного профиля с казахским: жёсткий фильтр обнулил бы категорию.
  const decorators = CONTRACTORS.filter((c) => c.categories.includes('Декоратор'));
  assert.equal(decorators.filter((c) => c.languages.includes('казахский')).length, 0);

  const r = applyFilters({
    city: 'Алматы',
    category: 'Декоратор',
    eventFormat: 'свадьба',
    date: '2026-10-12',
    language: 'казахский',
  });
  assert.ok(r.survivors.length > 0, 'язык не должен обнулять категорию, где он не является продуктом');
});

test('различители: структурные близнецы различаются по тексту профиля', () => {
  const r = match(req('S3'));
  assert.equal(r.cards.length, 3, 'сценарий S3 должен давать три карточки');

  // У тройки ансамблей совпадают цена, часы, язык и формат — отличие обязано найтись в описании.
  const values = r.cards.map((c) => c.differentiators.map((d) => d.value).join(' '));
  assert.equal(new Set(values).size, 3, 'различители трёх близнецов совпали');
  for (const c of r.cards) {
    assert.ok(c.differentiators.length > 0, `${c.name}: нет ни одного различителя`);
  }
});

test('третий ярус: полностью одинаковые профили получают честное признание сходства', () => {
  const clone = { id: 'X', name: 'A', category: 'Тест', city: 'Алматы', priceFromKzt: 1, score: 1,
    parts: {} as never, differentiators: [],
    facts: { priceRank: 1, priceDeltaToCheapest: 0, formatsCount: 2, languages: ['русский'],
      busyDaysAhead: 0, experienceClaims: [], wishChecks: [], alsoListedAs: [],
      priceImputed: false, synthetic: false } };
  const cards = [clone, { ...clone, id: 'Y', name: 'B' }];
  const out = assignDifferentiators(cards, { X: 'один и тот же текст', Y: 'один и тот же текст' });
  for (const c of out) {
    assert.equal(c.differentiators[0].tier, 3, 'ожидался третий ярус — признание сходства');
  }
});

test('ближайшие показываются только когда не прошёл никто', () => {
  for (const s of SCENARIOS) {
    const r = match(s.req);
    if (r.cards.length > 0) {
      assert.equal(r.nearestCards.length, 0, `${s.id}: ближайшие показаны при непустой выдаче`);
    }
  }
});

test('каждый исход объяснён словами, а не пустым экраном', () => {
  for (const s of SCENARIOS) {
    const r = match(s.req);
    assert.ok(r.message.length > 30, `${s.id}: сообщение слишком короткое`);
    assert.ok(/\d/.test(r.message), `${s.id}: в сообщении нет ни одного числа`);
  }
});
