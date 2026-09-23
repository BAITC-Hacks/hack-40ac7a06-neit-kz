import { parseRequest, type KnownFields } from '../lib/parse';
async function main() {
  let known: KnownFields = {};
  for (const reply of ['фотограф в алматы на 14 ноября', 'нет, давай лучше видеографа', 'бюджет 500 тысяч']) {
    const p = await parseRequest(reply, known);
    known = { city: p.city, date: p.date, category: p.category, eventFormat: p.eventFormat,
      budgetKzt: p.budgetKzt, durationHours: p.durationHours, language: p.language, wishes: p.wishes };
    console.log(`— ${reply}\n  понял: ${p.summary.replace(/\n/g, ' | ')}`);
  }
}
main();
