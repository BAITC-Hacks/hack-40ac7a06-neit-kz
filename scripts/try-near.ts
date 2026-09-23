import { match } from '../lib/match';
import type { MatchRequest } from '../lib/types';
const cases: MatchRequest[] = [
  { city: 'Алматы', category: 'Декоратор', eventFormat: 'свадьба', date: '2026-12-15', budgetKzt: 400_000 },
  { city: 'Астана', category: 'Банкетный зал', eventFormat: 'свадьба', date: '2026-11-14', budgetKzt: 300_000 },
  { city: 'Алматы', category: 'Ведущий церемонии', eventFormat: 'корпоратив', date: '2026-10-01', budgetKzt: 500_000 },
];
for (const req of cases) {
  const r = match(req);
  console.log(`\n=== ${req.category} · ${req.city} · ${req.date} · ${req.budgetKzt?.toLocaleString('ru-RU')} ₸ → ${r.outcome}`);
  console.log('  ' + r.message);
  for (const c of r.softCards) console.log(`  ○ [${c.relaxation?.rule}] ${c.name}: ${c.relaxation?.label}`);
  for (const c of r.nearestCards) console.log(`  ◇ ${c.name} (${c.priceFromKzt.toLocaleString('ru-RU')} ₸): ${c.relaxation?.detail}`);
}
