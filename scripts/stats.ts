/**
 * Числа для README — считаются, а не пишутся на глаз.
 *
 *   npm run stats
 *
 * Ключ OpenAI не нужен: всё считается по каталогу и ядру подбора.
 * Любое число из раздела «Краткое описание» README должно воспроизводиться этой командой,
 * иначе это не измерение, а утверждение.
 */
import { CONTRACTORS, META } from '../lib/catalog';
import { match } from '../lib/match';
import type { Contractor } from '../lib/types';

/** Даты перебора: две осенние и две декабрьские — декабрь в датасете заметно плотнее. */
const SWEEP_DATES = ['2026-10-01', '2026-11-14', '2026-12-06', '2026-12-12'];

const supplied = CONTRACTORS.filter((c) => !c.addedByTeam);
const added = CONTRACTORS.filter((c) => c.addedByTeam);

const pct = (n: number, total: number) => `${Math.round((n / total) * 100)}%`;
const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

/** Занятость внутри окна кейса: даты за его пределами в расчёт не идут. */
function busyInWindow(c: Contractor): number {
  return c.busyDates.filter((d) => d >= META.dateWindow.from && d <= META.dateWindow.to).length;
}

function windowDays(): number {
  const [fy, fm, fd] = META.dateWindow.from.split('-').map(Number);
  const [ty, tm, td] = META.dateWindow.to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

function decemberLoad(pool: Contractor[]): string {
  let busy = 0;
  let total = 0;
  for (const c of pool) {
    for (let d = 1; d <= 31; d++) {
      total++;
      if (c.busyDates.includes(`2026-12-${String(d).padStart(2, '0')}`)) busy++;
    }
  }
  return pct(busy, total);
}

if (META.profiles !== CONTRACTORS.length) {
  console.error(
    `⚠ meta.json: profiles = ${META.profiles}, а в каталоге ${CONTRACTORS.length}. ` +
      'Шапка экрана покажет неправду — поправьте data/meta.json.',
  );
  process.exitCode = 1;
}

console.log('## Каталог');
console.log(`профилей: ${CONTRACTORS.length} · из поставки: ${supplied.length} · дописано командой: ${added.length}`);
console.log(`окно дат: ${META.dateWindow.from} — ${META.dateWindow.to} (${windowDays()} дней)`);
console.log(`цена помечена оценочной: ${CONTRACTORS.filter((c) => c.priceImputed).length}`);
console.log(`max_hours = null (работа не привязана к присутствию): ${CONTRACTORS.filter((c) => c.maxHours === null).length}`);
console.log(`числятся больше чем в одной категории: ${CONTRACTORS.filter((c) => c.categories.length > 1).length}`);

console.log('\n## Занятость (в пределах окна кейса)');
console.log(`в среднем занято дней из ${windowDays()}: поставка ${avg(supplied.map(busyInWindow)).toFixed(0)} · весь каталог ${avg(CONTRACTORS.map(busyInWindow)).toFixed(0)}`);
console.log(`декабрь занят: поставка ${decemberLoad(supplied)} · весь каталог ${decemberLoad(CONTRACTORS)}`);

const outsideWindow = CONTRACTORS.reduce(
  (s, c) => s + c.busyDates.filter((d) => d < META.dateWindow.from || d > META.dateWindow.to).length,
  0,
);
if (outsideWindow > 0) {
  console.log(`дат за пределами окна (в подборе не участвуют): ${outsideWindow}`);
}

console.log('\n## Перебор комбинаций «город × категория × формат × дата»');
console.log(`даты перебора: ${SWEEP_DATES.join(', ')}`);

let total = 0;
const bucket = { three: 0, oneTwo: 0, zero: 0, noCategory: 0 };
for (const city of META.cities) {
  for (const category of META.categories) {
    for (const eventFormat of META.eventFormats) {
      for (const date of SWEEP_DATES) {
        total++;
        const r = match({ city, category, eventFormat, date });
        if (r.outcome === 'NO_CATEGORY_IN_CITY') bucket.noCategory++;
        else if (r.cards.length >= 3) bucket.three++;
        else if (r.cards.length === 0) bucket.zero++;
        else bucket.oneTwo++;
      }
    }
  }
}
console.log(`комбинаций: ${total}`);
console.log(`три и больше:        ${bucket.three} (${pct(bucket.three, total)})`);
console.log(`один-два:            ${bucket.oneTwo} (${pct(bucket.oneTwo, total)})`);
console.log(`ноль свободных:      ${bucket.zero} (${pct(bucket.zero, total)})`);
console.log(`категории нет в городе: ${bucket.noCategory} (${pct(bucket.noCategory, total)})`);
console.log(`меньше трёх, итого:  ${pct(total - bucket.three, total)}`);

console.log('\n## Плотность категорий в Алматы');
const density = META.categories
  .map((cat) => ({ cat, n: CONTRACTORS.filter((c) => c.city === 'Алматы' && c.categories.includes(cat)).length }))
  .sort((a, b) => b.n - a.n || a.cat.localeCompare(b.cat));
console.log('плотные:', density.slice(0, 3).map((d) => `${d.cat} ${d.n}`).join(' · '));
console.log('редкие: ', density.slice(-3).map((d) => `${d.cat} ${d.n}`).join(' · '));
