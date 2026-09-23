import { parseBrief } from '../lib/brief';

const TESTS = [
  'нужен ведущий и фотограф на свадьбу в Алматы 18 ноября, ведущему 900 тысяч, фотографу 300',
  'собираю корпоратив в Астане 5 ноября: ведущий, лайв-бэнд и фотограф, общий бюджет 3 млн',
  'нужен тамада на той 14 ноября в алматы за 800000',
];

async function main() {
  for (const t of TESTS) {
    const b = await parseBrief(t);
    console.log('\n> ' + t);
    console.log(`  позиций: ${b.positions.length}`);
    for (const p of b.positions) console.log(`   • ${p.summary}${p.wishes.length ? ' | пожелания: ' + p.wishes.join(', ') : ''}`);
    if (b.unsupported.length) console.log('  замечания:', b.unsupported.map((u) => `«${u.quote}» — ${u.reason}`).join('; '));
    if (b.question) console.log('  вопрос:', b.question);
  }
}
main();
