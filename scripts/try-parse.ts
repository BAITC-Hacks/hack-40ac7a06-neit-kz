import { parseRequest } from '../lib/parse';

const TESTS = [
  'Нужен ведущий в АСтану, на 24 декабря, за 1 миллион тенге',
  'Нужен ведущий в АСтану, на 24 декабря, за 1 миллион тенге, на свадьбу',
  'хочу ведущего из Шымкента на той 5 октября за 700 тысяч',
  'фотографа в Алмате на свадьбу 12 октября до 400 тысяч',
  'нужен фотограф недорого',
  'нужин вядущий на карпоратив в астанне 5 ноября, бюджет 900 тыщ',
  'тамаду на тоййй в алматы 14 ноебря за 800000',
];

async function main() {
  for (const t of TESTS) {
    const p = await parseRequest(t);
    console.log('\n> ' + t);
    console.log('  сводка:', p.summary.replace(/\n/g, ' | '));
    if (p.missing.length) console.log('  не хватает:', p.missing.join(', '));
    if (p.unsupported.length) console.log('  замечания:', p.unsupported.map((u) => `«${u.quote}» — ${u.reason}`).join('; '));
    if (p.question) console.log('  вопрос:', p.question);
  }
}
main();
