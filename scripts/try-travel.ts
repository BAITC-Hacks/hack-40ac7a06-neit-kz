import { match } from '../lib/match';
import scenarios from '../data/scenarios.json';
import type { MatchRequest } from '../lib/types';
const wanted = ['S6', 'S11', 'S12'];
for (const s of (scenarios as Array<{id:string;title:string;req:MatchRequest}>).filter((x) => wanted.includes(x.id))) {
  const r = match(s.req);
  console.log(`\n=== ${s.id} ${s.title} → ${r.outcome}`);
  for (const c of [...r.softCards, ...r.nearestCards]) {
    const t = c.relaxation?.travel;
    console.log(`  ${c.relaxation?.rule.padEnd(8)} ${c.name} (${c.priceFromKzt.toLocaleString('ru-RU')} ₸)` +
      (t ? ` | проезд ${t.totalKzt.toLocaleString('ru-RU')} ₸ = ${t.perPersonKzt.toLocaleString('ru-RU')} × ${t.headcount} чел. [${t.basis}]` : ' | проезд не считаем'));
  }
}
