import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import type { Card, MatchRequest } from './types';

/**
 * Объяснения. Модель работает только на языковом краю: решения уже приняты кодом,
 * ей дают готовые факты и различители. Всё, что она написала, проверяется валидатором.
 *
 * Детерминизм: temperature=0 не гарантирует одинаковый ответ у провайдера —
 * гарантию даёт кэш по хешу (запрос + факты + версия промпта + модель).
 */

const MODEL = 'gpt-4.1-mini';
const PROMPT_VERSION = 'v1';
const CACHE_PATH = join(process.cwd(), 'data', 'explanations-cache.json');

/** Порог взаимозаменяемости: доля общих значимых слов между двумя объяснениями. */
const MAX_PAIR_OVERLAP = 0.35;

const BANNED = [
  'отличный выбор',
  'идеально подойдёт',
  'идеально подходит',
  'профессионал своего дела',
  'индивидуальный подход',
  'создаст атмосферу',
  'незабываем',
  'на высшем уровне',
  'качественно и в срок',
];

type Explanations = Record<string, string>;

let cache: Explanations | null = null;

function loadCache(): Explanations {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Explanations;
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache(): void {
  // На Vercel файловая система только для чтения — пишем best-effort.
  //
  // Сливаем с тем, что уже на диске: иначе долгоживущий процесс (dev-сервер,
  // поднятый до генерации эталонов) запишет свою устаревшую копию и затрёт
  // записи, добавленные другим процессом. Один раз уже наступили.
  try {
    let onDisk: Explanations = {};
    try {
      onDisk = JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as Explanations;
    } catch {
      onDisk = {};
    }
    const merged = { ...onDisk, ...(cache ?? {}) };
    cache = merged;
    writeFileSync(CACHE_PATH, JSON.stringify(merged, null, 1), 'utf8');
  } catch {
    /* ignore */
  }
}

function cacheKey(req: MatchRequest, cards: Card[]): string {
  const payload = JSON.stringify({
    req,
    cards: cards.map((c) => ({ id: c.id, facts: c.facts, diffs: c.differentiators, price: c.priceFromKzt })),
    PROMPT_VERSION,
    MODEL,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

function factSheet(card: Card, req: MatchRequest) {
  const f = card.facts;
  return {
    id: card.id,
    имя: card.name,
    категория: card.category,
    город: card.city,
    цена: card.priceFromKzt,
    цена_ориентировочная: f.priceImputed,
    синтетический_профиль: f.synthetic,
    место_по_цене: f.priceRank,
    дороже_самого_дешёвого_на: f.priceDeltaToCheapest,
    остаток_бюджета: f.budgetLeftover,
    запас_часов: f.hoursSpare,
    форматов_берёт: f.formatsCount,
    языки: f.languages,
    опыт: f.experienceClaims,
    пожелания: f.wishChecks.map((w) => ({
      пожелание: w.wish,
      подтверждено: w.confirmed,
      фрагмент: w.evidence,
    })),
    также_числится_как: f.alsoListedAs,
    различители: card.differentiators.map((d) => d.value),
    послабление: card.relaxation?.detail,
  };
}

export function systemPrompt(): string {
  return [
    'Ты пишешь короткие объяснения для карточек подрядчиков на площадке подбора event-услуг.',
    'На каждую карточку — 1–2 предложения на русском языке.',
    '',
    'ЖЁСТКИЕ ПРАВИЛА:',
    '1. Используй ТОЛЬКО факты из переданного JSON. Не добавляй ничего от себя.',
    '2. Каждое число, дата и язык в тексте обязаны присутствовать в фактах этой карточки.',
    '3. Обязательно используй «различители» — это то, чем карточка отличается от остальных в выдаче.',
    '4. Запрещено писать факты, общие для всех карточек (город, формат, свободная дата).',
    '5. Запрещены общие фразы: «отличный выбор», «идеально подойдёт», «профессионал своего дела»,',
    '   «индивидуальный подход», «создаст атмосферу», «незабываемо».',
    '6. Имя подрядчика бери ТОЛЬКО из поля «имя». В описаниях встречаются другие бренды — игнорируй их.',
    '7. ВАЖНО: если «подтверждено: false» — ОБЯЗАТЕЛЬНО напиши, что этого в профиле не упомянуто.',
    '   Пример: «про розы в профиле не упомянуто — указано только сезонные и привозные цветы».',
    '   Никогда не пиши так, будто пожелание выполнено.',
    '8. Если цена ориентировочная или профиль синтетический — упомяни это одной короткой оговоркой.',
    '9. Если текст можно переставить в другую карточку без потери смысла — перепиши.',
    '',
    'Ответ — JSON: {"explanations":[{"id":"HK-...","text":"..."}]}',
  ].join('\n');
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length > 3);
}

function jaccard(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
}

function numbersIn(s: string): string[] {
  return (s.match(/\d[\d\s  ]*/g) ?? []).map((x) => x.replace(/[\s  ]/g, '')).filter((x) => x.length > 0);
}

/** Числа объяснения обязаны встречаться в фактах карточки — защита от выдумок. */
function numbersGrounded(text: string, sheet: object): boolean {
  const haystack = JSON.stringify(sheet).replace(/[\s  ]/g, '');
  return numbersIn(text).every((n) => haystack.includes(n));
}

export type ValidationIssue = { id: string; problem: string };

export function validate(cards: Card[], texts: Explanations, req: MatchRequest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const card of cards) {
    const text = texts[card.id];
    if (!text) {
      issues.push({ id: card.id, problem: 'нет текста' });
      continue;
    }
    const lower = text.toLowerCase();
    const banned = BANNED.find((b) => lower.includes(b));
    if (banned) issues.push({ id: card.id, problem: `общая фраза «${banned}»` });
    if (!numbersGrounded(text, factSheet(card, req))) {
      issues.push({ id: card.id, problem: 'в тексте есть число, которого нет в фактах' });
    }
    // Неподтверждённое пожелание обязано быть названо вслух — иначе выдача выглядит
    // так, будто пожелание выполнено. Это главный тест на «не выдумывать».
    const unconfirmed = card.facts.wishChecks.filter((w) => !w.confirmed);
    if (unconfirmed.length && !/не упомян|не указан|нет упоминан|не сказан/i.test(text)) {
      issues.push({
        id: card.id,
        problem: `не сказано, что пожелание «${unconfirmed[0].wish}» в профиле не упомянуто`,
      });
    }
  }
  // Попарная взаимозаменяемость
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = texts[cards[i].id];
      const b = texts[cards[j].id];
      if (a && b && jaccard(a, b) > MAX_PAIR_OVERLAP) {
        issues.push({
          id: cards[j].id,
          problem: `слишком похоже на карточку ${cards[i].name} (пересечение ${jaccard(a, b).toFixed(2)})`,
        });
      }
    }
  }
  return issues;
}

/** Шаблон из фактов: работает без модели и всегда даёт конкретику. */
export function templateExplanation(card: Card, req: MatchRequest): string {
  const bits: string[] = [];
  for (const diff of card.differentiators.slice(0, 2)) {
    if (diff.axis === 'price') continue; // цена и так печатается ниже
    bits.push(diff.tier === 2 ? `Из профиля: ${diff.value}` : `Отличие: ${diff.value}`);
  }
  if (card.facts.budgetLeftover !== undefined && card.facts.budgetLeftover >= 0) {
    bits.push(
      `Цена ${card.priceFromKzt.toLocaleString('ru-RU')} ₸ — остаётся ${card.facts.budgetLeftover.toLocaleString('ru-RU')} ₸ от бюджета`,
    );
  } else {
    bits.push(`Цена ${card.priceFromKzt.toLocaleString('ru-RU')} ₸`);
  }
  if (card.facts.hoursSpare !== undefined && card.facts.hoursSpare > 0) {
    bits.push(`запас ${card.facts.hoursSpare} ч сверх вашей программы`);
  }
  const notConfirmed = card.facts.wishChecks.filter((w) => !w.confirmed).map((w) => w.wish);
  if (notConfirmed.length) bits.push(`в профиле не упомянуто: ${notConfirmed.join(', ')}`);
  if (card.facts.priceImputed) bits.push('цена в каталоге ориентировочная');
  if (card.facts.synthetic) bits.push('профиль помечен как синтетический');
  return `${bits.join('. ')}.`;
}

export type ExplainResult = {
  texts: Explanations;
  source: 'cache' | 'model' | 'template';
  issues: ValidationIssue[];
  retried: boolean;
};

export async function explain(cards: Card[], req: MatchRequest): Promise<ExplainResult> {
  if (cards.length === 0) return { texts: {}, source: 'template', issues: [], retried: false };

  const key = cacheKey(req, cards);
  const store = loadCache();
  if (store[key]) {
    return { texts: JSON.parse(store[key]) as Explanations, source: 'cache', issues: [], retried: false };
  }

  const fallback = (): ExplainResult => ({
    texts: Object.fromEntries(cards.map((c) => [c.id, templateExplanation(c, req)])),
    source: 'template',
    issues: [],
    retried: false,
  });

  if (!process.env.OPENAI_API_KEY || process.env.LLM_ENABLED === 'false') return fallback();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const payload = {
    запрос: req,
    карточки: cards.map((c) => factSheet(c, req)),
  };

  async function ask(extra?: string): Promise<Explanations> {
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: JSON.stringify(payload, null, 1) },
        ...(extra ? [{ role: 'user' as const, content: extra }] : []),
      ],
    });
    const raw = res.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as { explanations?: Array<{ id: string; text: string }> };
    return Object.fromEntries((parsed.explanations ?? []).map((e) => [e.id, e.text]));
  }

  try {
    let texts = await ask();
    let issues = validate(cards, texts, req);
    let retried = false;

    if (issues.length) {
      retried = true;
      const fix =
        'Перепиши объяснения, исправив проблемы: ' +
        issues.map((i) => `${i.id}: ${i.problem}`).join('; ') +
        '. Опирайся на «различители» каждой карточки.';
      const second = await ask(fix);
      const secondIssues = validate(cards, second, req);
      if (secondIssues.length < issues.length) {
        texts = second;
        issues = secondIssues;
      }
    }

    // Карточки, не прошедшие проверку, заменяем шаблоном — пустого экрана не будет.
    const broken = new Set(issues.map((i) => i.id));
    for (const card of cards) {
      if (broken.has(card.id) || !texts[card.id]) texts[card.id] = templateExplanation(card, req);
    }

    store[key] = JSON.stringify(texts);
    saveCache();
    return { texts, source: 'model', issues, retried };
  } catch {
    return fallback();
  }
}
