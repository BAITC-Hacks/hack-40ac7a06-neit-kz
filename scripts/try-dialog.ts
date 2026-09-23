import { parseRequest, type KnownFields } from '../lib/parse';

const REPLIES = ['нужен фотограф недорого', 'в Алматы', '14 ноября, на свадьбу', 'бюджет 400 тысяч, хочу репортажную съёмку'];

async function main() {
  let known: KnownFields = {};
  for (const reply of REPLIES) {
    const p = await parseRequest(reply, known);
    known = {
      city: p.city, date: p.date, category: p.category, eventFormat: p.eventFormat,
      budgetKzt: p.budgetKzt, durationHours: p.durationHours, language: p.language, wishes: p.wishes,
    };
    console.log(`\n— ${reply}`);
    console.log(`  понял: ${p.summary.replace(/\n/g, ' | ')}`);
    if (p.question) console.log(`  спрашиваю: ${p.question}`);
    else console.log('  всё есть, можно искать');
  }
}
main();
