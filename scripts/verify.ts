/**
 * Прогон всех сценариев и сверка с эталонными ответами из samples/golden.
 *
 *   npm run verify           — проверить (ключ OpenAI не нужен: объяснения берутся из кэша)
 *   npm run verify -- --update  — перезаписать эталоны (нужен ключ)
 *
 * В снимок намеренно не попадают тайминги: иначе каждый прогон давал бы расхождение.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import scenarios from '../data/scenarios.json';
import { match } from '../lib/match';
import { explain } from '../lib/explain';
import type { Card, MatchRequest } from '../lib/types';

type Scenario = { id: string; title: string; req: MatchRequest };

const GOLDEN_DIR = join(process.cwd(), 'samples', 'golden');
const REPORT_PATH = join(process.cwd(), 'samples', 'report.md');
const update = process.argv.includes('--update');

function snapshotCard(c: Card) {
  return {
    id: c.id,
    name: c.name,
    priceFromKzt: c.priceFromKzt,
    score: c.score,
    explanation: c.explanation,
    differentiators: c.differentiators,
    relaxation: c.relaxation?.rule,
    relaxationDetail: c.relaxation?.detail,
    travelTotalKzt: c.relaxation?.travel?.totalKzt,
    travelBasis: c.relaxation?.travel?.basis,
    wishChecks: c.facts.wishChecks,
    synthetic: c.facts.synthetic,
    priceImputed: c.facts.priceImputed,
  };
}

async function runScenario(s: Scenario) {
  const r = match(s.req);
  const all = [...r.cards, ...r.softCards, ...r.nearestCards];
  const { texts, source } = await explain(all, s.req);
  const withText = (c: Card) => ({ ...c, explanation: texts[c.id] });
  return {
    snapshot: {
      id: s.id,
      request: s.req,
      outcome: r.outcome,
      message: r.message,
      cards: r.cards.map(withText).map(snapshotCard),
      softCards: r.softCards.map(withText).map(snapshotCard),
      nearestCards: r.nearestCards.map(withText).map(snapshotCard),
      funnel: r.funnel,
      nearMisses: r.nearMisses,
      notes: r.notes,
    },
    source,
    ms: r.timings.totalMs,
  };
}

/** Доля общих значимых слов — мера взаимозаменяемости объяснений. */
function overlap(a: string, b: string): number {
  const w = (s: string) =>
    new Set(
      s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/i).filter((x) => x.length > 3),
    );
  const A = w(a);
  const B = w(b);
  if (!A.size || !B.size) return 0;
  return [...A].filter((x) => B.has(x)).length / new Set([...A, ...B]).size;
}

async function main() {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const rows: string[] = [];
  let failed = 0;
  let maxOverlap = 0;
  let cardsTotal = 0;
  let cardsWithNumber = 0;

  for (const s of scenarios as Scenario[]) {
    const { snapshot, source, ms } = await runScenario(s);
    const file = join(GOLDEN_DIR, `${s.id}.json`);
    const text = `${JSON.stringify(snapshot, null, 1)}\n`;

    let status: string;
    if (update || !existsSync(file)) {
      writeFileSync(file, text, 'utf8');
      status = update ? 'ЭТАЛОН ОБНОВЛЁН' : 'ЭТАЛОН СОЗДАН';
    } else {
      status = readFileSync(file, 'utf8') === text ? 'PASS' : 'FAIL';
      if (status === 'FAIL') failed++;
    }

    // метрики качества объяснений
    const cards = snapshot.cards;
    for (let i = 0; i < cards.length; i++) {
      cardsTotal++;
      if (/\d/.test(cards[i].explanation ?? '')) cardsWithNumber++;
      for (let j = i + 1; j < cards.length; j++) {
        maxOverlap = Math.max(maxOverlap, overlap(cards[i].explanation ?? '', cards[j].explanation ?? ''));
      }
    }

    const line = `| ${s.id} | ${s.title} | ${snapshot.outcome} | ${snapshot.cards.length} + ${snapshot.softCards.length} + ${snapshot.nearestCards.length} | ${ms} мс | ${source} | ${status} |`;
    rows.push(line);
    console.log(
      `${status.padEnd(15)} ${s.id}  ${snapshot.outcome.padEnd(20)} карточек ${snapshot.cards.length}+${snapshot.softCards.length}+${snapshot.nearestCards.length}  ${ms} мс  (${source})`,
    );
  }

  const report = [
    '# Отчёт прогона сценариев',
    '',
    'Сгенерирован `npm run verify`. Тайминги в эталоны не входят.',
    '',
    '| # | Сценарий | Исход | Карточек (основные + послабления + ближайшие) | Время | Объяснения | Статус |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    '## Метрики объяснений',
    '',
    `- Максимальное пересечение объяснений внутри одной выдачи: **${maxOverlap.toFixed(2)}** (порог браковки 0.35).`,
    `- Доля объяснений с конкретным числом: **${cardsTotal ? Math.round((cardsWithNumber / cardsTotal) * 100) : 0}%** (${cardsWithNumber} из ${cardsTotal}).`,
    '',
  ].join('\n');
  writeFileSync(REPORT_PATH, report, 'utf8');

  console.log(`\nмаксимальное пересечение объяснений: ${maxOverlap.toFixed(2)} (порог 0.35)`);
  console.log(`отчёт: samples/report.md`);
  if (failed) {
    console.error(`\nНЕ СОВПАЛО сценариев: ${failed}`);
    process.exit(1);
  }
  console.log('\nвсе сценарии совпали с эталонами');
}

void main();
