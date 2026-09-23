import { match } from '../lib/match';
import type { MatchRequest } from '../lib/types';

const SCENARIOS: Array<{ title: string; req: MatchRequest }> = [
  { title: 'S1 плотная категория', req: { city: 'Алматы', category: 'Ведущий', eventFormat: 'корпоратив', date: '2026-10-01', budgetKzt: 1_500_000 } },
  { title: 'S2 та же, другая дата', req: { city: 'Алматы', category: 'Ведущий', eventFormat: 'корпоратив', date: '2026-12-12', budgetKzt: 1_500_000 } },
  { title: 'S3 тройка близнецов', req: { city: 'Алматы', category: 'Национальный ансамбль', eventFormat: 'той', date: '2026-10-09', budgetKzt: 600_000 } },
  { title: 'S4 редкая категория', req: { city: 'Алматы', category: 'Флорист', eventFormat: 'свадьба', date: '2026-10-17', budgetKzt: 400_000 } },
  { title: 'S5 сдвиг монтажа', req: { city: 'Алматы', category: 'Декоратор', eventFormat: 'свадьба', date: '2026-10-22', budgetKzt: 2_500_000 } },
  { title: 'S6 перелёт', req: { city: 'Астана', category: 'Лайв-бэнд', eventFormat: 'корпоратив', date: '2026-09-25', budgetKzt: 2_500_000 } },
  { title: 'S7 двойной отказ', req: { city: 'Астана', category: 'Банкетный зал', eventFormat: 'свадьба', date: '2026-11-14', budgetKzt: 300_000 } },
  { title: 'S8 формат не берёт никто', req: { city: 'Алматы', category: 'Ведущий церемонии', eventFormat: 'корпоратив', date: '2026-10-01', budgetKzt: 500_000 } },
  { title: 'S9 пожелание без подтверждения', req: { city: 'Алматы', category: 'Флорист', eventFormat: 'свадьба', date: '2026-10-12', budgetKzt: 400_000, wishes: ['украсит розами'] } },
];

for (const { title, req } of SCENARIOS) {
  const r = match(req);
  console.log('\n' + '='.repeat(80));
  console.log(`${title} → ${r.outcome}  (${r.timings.totalMs} мс)`);
  console.log('воронка:', r.funnel.map((f) => `${f.step} ${f.after}`).join(' → '));
  console.log('сообщение:', r.message);
  for (const c of r.cards) {
    console.log(`  ▸ ${c.name} (${c.priceFromKzt.toLocaleString('ru-RU')} ₸) score=${c.score}`);
    console.log(`    различители: ${c.differentiators.map((d) => `[${d.tier}] ${d.value}`).join(' | ')}`);
    if (c.facts.wishChecks.length) console.log(`    пожелания: ${c.facts.wishChecks.map((w) => `${w.wish}=${w.confirmed ? 'да' : 'НЕ упомянуто'}`).join(', ')}`);
  }
  for (const c of r.softCards) {
    console.log(`  ○ [${c.relaxation?.rule}] ${c.name}: ${c.relaxation?.label}`);
  }
  if (r.nearMisses.length) console.log('  отсеяны:', r.nearMisses.map((n) => `${n.name} (${n.reason})`).join('; '));
  if (r.notes.length) console.log('  примечания:', r.notes.join(' / '));
}
