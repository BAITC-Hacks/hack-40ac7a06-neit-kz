import { parseRequest } from '../lib/parse';

const TESTS = [
  'нужен ведущий на свадьбу в Алматы 18 ноября, бюджет до миллиона, чтобы вёл на казахском и без пошлых конкурсов',
  'хочу ведущего из Шымкента на той 5 октября за 700 тысяч',
  'флорист, который украсит розами, Алматы, 12 октября, до 400 тысяч',
  'нужен фотограф недорого',
  'банкетный зал в Астане на 14 ноября на 200 человек, 3 млн',
];

async function main() {
  for (const t of TESTS) {
    const p = await parseRequest(t);
    console.log('\n> ' + t);
    console.log('  сводка:', p.summary.replace(/\n/g, ' | '));
    if (p.missing.length) console.log('  не хватает:', p.missing.join(', '));
    if (p.unsupported.length) console.log('  нет в каталоге:', p.unsupported.map((u) => `«${u.quote}» — ${u.reason}`).join('; '));
    if (p.question) console.log('  вопрос:', p.question);
  }
}
main();
