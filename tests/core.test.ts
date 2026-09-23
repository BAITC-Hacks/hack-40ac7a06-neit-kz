import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CONTRACTORS, META } from '../lib/catalog';
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

test('пустой max_hours проходит фильтр длительности, сколько бы профилей ни было', () => {
  const noLimit = CONTRACTORS.filter((c) => c.maxHours === null);
  assert.ok(noLimit.length > 0, 'в каталоге должны быть профили без лимита часов');

  // Свойство, а не число: ни один профиль без лимита часов не должен отсеиваться длительностью.
  for (const c of noLimit.slice(0, 20)) {
    const r = applyFilters({
      city: c.city,
      category: c.categories[0],
      date: '2026-10-12',
      durationHours: 24,
    });
    const dropped = r.funnel.find((f) => f.step === 'длительность')?.dropped ?? 0;
    assert.equal(dropped, 0, `${c.name}: фильтр длительности отсеял профиль без лимита часов`);
  }
});

test('даты сравниваются строками: граница месяца не уезжает', () => {
  // Если где-то появится new Date('2026-11-01'), тест на границе месяца это поймает.
  const c = CONTRACTORS.find((x) => x.busyDates.some((d) => d.endsWith('-01')))!;
  const busyFirst = c.busyDates.find((d) => d.endsWith('-01'))!;
  const r = applyFilters({ city: c.city, category: c.categories[0], date: busyFirst });
  assert.ok(!r.survivors.some((x) => x.id === c.id), `${c.name} занят ${busyFirst}, но прошёл фильтр`);
});

test('язык жёсткий только там, где продукт — речь и вокал', () => {
  // Ищем в каталоге языко-мягкую категорию, где нужного языка нет ни у кого:
  // жёсткий фильтр обнулил бы её на ровном месте.
  const soft = META.categories.filter((c) => !META.langCriticalCategories.includes(c));
  const victim = soft
    .map((category) => {
      const pool = CONTRACTORS.filter((c) => c.categories.includes(category));
      const lang = META.languages.find((l) => pool.length > 0 && !pool.some((c) => c.languages.includes(l)));
      return lang ? { category, lang, city: pool[0].city } : null;
    })
    .find(Boolean);

  if (!victim) return; // в каталоге нет такой пары — проверять нечего

  const r = applyFilters({
    city: victim.city,
    category: victim.category,
    date: '2026-10-12',
    language: victim.lang,
  });
  const dropped = r.funnel.find((f) => f.step === 'язык')?.dropped ?? 0;
  assert.equal(dropped, 0, `язык обнулил категорию «${victim.category}», где он не является продуктом`);
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
