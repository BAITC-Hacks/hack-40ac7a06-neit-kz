import { match } from '../lib/match';
import { explain } from '../lib/explain';
import type { MatchRequest } from '../lib/types';

const REQS: Record<string, MatchRequest> = {
  twins: { city: 'Алматы', category: 'Национальный ансамбль', eventFormat: 'той', date: '2026-10-09', budgetKzt: 600_000 },
  hosts: { city: 'Алматы', category: 'Ведущий', eventFormat: 'корпоратив', date: '2026-10-01', budgetKzt: 1_500_000 },
  roses: { city: 'Алматы', category: 'Флорист', eventFormat: 'свадьба', date: '2026-10-12', budgetKzt: 400_000, wishes: ['украсит розами'] },
};

async function main() {
  const req = REQS[process.argv[2] ?? 'hosts'];
  const r = match(req);
  const t0 = Date.now();
  const { texts, source, issues, retried } = await explain([...r.cards, ...r.softCards], req);
  console.log(`источник: ${source} | повтор: ${retried} | проблем: ${issues.length} | ${Date.now() - t0} мс\n`);
  for (const c of [...r.cards, ...r.softCards]) {
    console.log(`▸ ${c.name} (${c.priceFromKzt.toLocaleString('ru-RU')} ₸)`);
    console.log(`  ${texts[c.id]}\n`);
  }
  if (issues.length) console.log('проблемы:', issues);
}
main();
