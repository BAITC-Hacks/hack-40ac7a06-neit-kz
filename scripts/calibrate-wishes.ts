import { CONTRACTORS } from '../lib/catalog';
import { bestSentence, embedWish } from '../lib/embeddings';

const CASES: Array<{ wish: string; category: string; expect: 'да' | 'нет' }> = [
  { wish: 'украсит розами', category: 'Флорист', expect: 'нет' },
  { wish: 'цветочное оформление свадьбы', category: 'Флорист', expect: 'да' },
  { wish: 'живая музыка на праздник', category: 'Лайв-бэнд', expect: 'да' },
  { wish: 'ведёт на казахском языке', category: 'Ведущий', expect: 'да' },
  { wish: 'без пошлых конкурсов', category: 'Ведущий', expect: 'да' },
  { wish: 'репортажная съёмка без постановки', category: 'Фотограф', expect: 'да' },
  { wish: 'нужен гипноз и фокусы', category: 'Ведущий', expect: 'нет' },
  { wish: 'зал на 500 человек с парковкой', category: 'Банкетный зал', expect: 'да' },
  { wish: 'доставка дронами', category: 'Подарки и сувениры', expect: 'нет' },
];

async function main() {
  for (const c of CASES) {
    const vec = await embedWish(c.wish);
    if (!vec) { console.log('нет вектора для', c.wish); continue; }
    const pool = CONTRACTORS.filter((x) => x.categories.includes(c.category));
    const scored = pool
      .map((p) => ({ name: p.name, ...(bestSentence(p.id, vec) ?? { text: '', score: 0 }) }))
      .sort((a, b) => b.score - a.score);
    const top = scored[0];
    const median = scored[Math.floor(scored.length / 2)];
    console.log(
      `${c.expect === 'да' ? '✓' : '✗'} «${c.wish}» → макс ${top.score.toFixed(3)} (${top.name}), медиана ${median.score.toFixed(3)}`,
    );
    console.log(`     ${top.text.slice(0, 110)}`);
  }
}
main();
