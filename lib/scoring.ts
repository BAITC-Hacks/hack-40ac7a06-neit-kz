import { alsoListedAs, isLanguageCritical, nextFreeDate } from './catalog';
import { bestSentence, WISH_MATCH_THRESHOLD } from './embeddings';
import type { Contractor, Facts, MatchRequest, ScoreParts, WishCheck } from './types';

/**
 * Веса. Всё, по чему кандидат ПРОШЁЛ жёсткий фильтр, различающей силы не имеет:
 * город, формат и «свободен на дату» одинаковы у всех выживших по построению.
 * Поэтому вес отдан тому, что различает кандидатов между собой.
 */
export const WEIGHTS: ScoreParts = {
  wishes: 0.35,
  formatFocus: 0.15,
  priceFit: 0.15,
  experience: 0.1,
  language: 0.1,
  duration: 0.1,
  semantic: 0.05,
};

const ALL_FORMATS = 6;

/** Нормализация для словарного сравнения: регистр, ё, окончания слов не трогаем. */
function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((t) => t.length > 2);
}

/** Грубая основа слова: отрезаем русские окончания, чтобы «розами» = «розы». */
function stem(t: string): string {
  return t.replace(/(ами|ями|ого|его|ует|ать|ить|ов|ев|ах|ях|ам|ям|ой|ей|ые|ий|ая|ое|ы|и|а|у|е|о)$/u, '');
}

function stems(s: string): Set<string> {
  return new Set(tokens(s).map(stem));
}

/** Предложения описания — ищем в них улику под пожелание. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 10);
}

/**
 * Пожелание считается подтверждённым, если хотя бы одно предложение описания
 * содержит не меньше половины значимых основ пожелания (минимум одну).
 * Порог намеренно консервативный: лучше честное «не упомянуто», чем выдуманное совпадение.
 */
export type WishVectors = Record<string, number[]>;

/**
 * Пожелание подтверждается семантикой, если ближайшее предложение описания
 * достаточно близко по смыслу; порог 0.42 выбран замером на реальных парах
 * (см. README). Вектора нет — падаем на словарное сравнение и честно это помечаем.
 */
export function checkWishes(
  c: Contractor,
  wishes: string[] | undefined,
  vectors?: WishVectors,
): WishCheck[] {
  if (!wishes?.length) return [];
  return wishes.map((wish) => {
    const vec = vectors?.[wish];
    if (vec) {
      const best = bestSentence(c.id, vec);
      const score = best ? Math.round(best.score * 1000) / 1000 : 0;
      return best && score >= WISH_MATCH_THRESHOLD
        ? { wish, confirmed: true, evidence: best.text, source: 'semantic' as const, score }
        : { wish, confirmed: false, source: 'semantic' as const, score };
    }

    // Словарная подстраховка: совпадение основ слов в одном предложении.
    const need = [...stems(wish)];
    if (need.length === 0) return { wish, confirmed: false, source: 'none' as const };
    let bestHit = { hits: 0, sentence: '' };
    for (const sentence of sentences(c.description)) {
      const have = stems(sentence);
      const hits = need.filter((n) => have.has(n)).length;
      if (hits > bestHit.hits) bestHit = { hits, sentence };
    }
    const required = Math.max(1, Math.ceil(need.length / 2));
    return bestHit.hits >= required
      ? { wish, confirmed: true, evidence: bestHit.sentence, source: 'lexical' as const }
      : { wish, confirmed: false, source: 'lexical' as const };
  });
}

const EXPERIENCE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/(\d+)\s*(?:лет|года|год)\b/i, (m) => `${m[1]} лет опыта`],
  [/более\s+(\d+)\s*(?:лет|года)/i, (m) => `более ${m[1]} лет опыта`],
  [/(\d{2,5})\s*(?:мероприяти|свадеб|съёмок|съемок|заказов)/i, (m) => `${m[1]} мероприятий`],
  [/топ[-\s]?(\d+)/i, (m) => `входит в топ-${m[1]}`],
  [/(победител|финалист|лауреат|преми)/i, () => 'есть награды'],
];

export function experienceClaims(c: Contractor): string[] {
  const out: string[] = [];
  for (const [re, fmt] of EXPERIENCE_PATTERNS) {
    const m = c.description.match(re);
    if (m) out.push(fmt(m));
  }
  return [...new Set(out)];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function scoreParts(c: Contractor, req: MatchRequest, checks: WishCheck[]): ScoreParts {
  // Пожелания: доля подтверждённых. Нет пожеланий — фактор нейтрален, вес перераспределяется.
  const wishes = checks.length ? checks.filter((w) => w.confirmed).length / checks.length : 0;

  // Специализация: узкий специалист точнее универсала «на все шесть форматов».
  const formatFocus = clamp01((ALL_FORMATS - c.eventFormats.length) / (ALL_FORMATS - 1));

  // Запас бюджета. Без бюджета фактор нейтрален для всех — на порядок не влияет.
  const priceFit = req.budgetKzt ? clamp01((req.budgetKzt - c.priceFromKzt) / req.budgetKzt) : 0.5;

  const claims = experienceClaims(c);
  const experience = clamp01(claims.length / 3);

  // Язык: в языко-критичных категориях он уже отработал фильтром, тут нейтрален.
  let language = 0.5;
  if (req.language && !isLanguageCritical(req.category)) {
    language = c.languages.includes(req.language) ? 1 : 0.2;
  } else if (req.language) {
    language = c.languages.length > 1 ? 1 : 0.8;
  }

  // Длительность: запас часов. Без лимита часов — нейтрально, без штрафа.
  let duration = 0.5;
  if (req.durationHours) {
    duration = c.maxHours === null ? 0.5 : clamp01((c.maxHours - req.durationHours) / 4);
  }

  // Семантика описания к типу мероприятия — слабый сигнал, вес 0.05.
  const semantic = req.eventFormat
    ? clamp01([...stems(req.eventFormat)].filter((t) => stems(c.description).has(t)).length)
    : 0.5;

  return { wishes, formatFocus, priceFit, experience, language, duration, semantic };
}

/** Если пожеланий нет, вес 0.35 распределяется по остальным факторам пропорционально. */
export function effectiveWeights(hasWishes: boolean): ScoreParts {
  if (hasWishes) return WEIGHTS;
  const rest = Object.entries(WEIGHTS).filter(([k]) => k !== 'wishes');
  const sum = rest.reduce((a, [, v]) => a + v, 0);
  const scaled = Object.fromEntries(rest.map(([k, v]) => [k, v / sum])) as ScoreParts;
  return { ...scaled, wishes: 0 };
}

export function totalScore(parts: ScoreParts, hasWishes: boolean): number {
  const w = effectiveWeights(hasWishes);
  const raw =
    parts.wishes * w.wishes +
    parts.formatFocus * w.formatFocus +
    parts.priceFit * w.priceFit +
    parts.experience * w.experience +
    parts.language * w.language +
    parts.duration * w.duration +
    parts.semantic * w.semantic;
  // Округление до 4 знаков — иначе тай-брейк по id не спасёт от дребезга float.
  return Math.round(raw * 10_000) / 10_000;
}

export function buildFacts(
  c: Contractor,
  req: MatchRequest,
  pool: Contractor[],
  checks: WishCheck[],
): Facts {
  const prices = [...pool].map((p) => p.priceFromKzt).sort((a, b) => a - b);
  const cheapest = prices[0] ?? c.priceFromKzt;
  return {
    priceRank: prices.indexOf(c.priceFromKzt) + 1,
    priceDeltaToCheapest: c.priceFromKzt - cheapest,
    budgetLeftover: req.budgetKzt ? req.budgetKzt - c.priceFromKzt : undefined,
    hoursSpare:
      req.durationHours && c.maxHours !== null ? c.maxHours - req.durationHours : undefined,
    formatsCount: c.eventFormats.length,
    languages: c.languages,
    busyDaysAhead: c.busyDates.filter((d) => d > req.date).length,
    nextFreeDate: nextFreeDate(c, req.date),
    experienceClaims: experienceClaims(c),
    wishChecks: checks,
    alsoListedAs: alsoListedAs(c, req.category),
    priceImputed: c.priceImputed,
    synthetic: c.synthetic,
  };
}

/** Сортировка: score вниз, тай-брейк по id — гарантия одинакового порядка. */
export function byScoreThenId<T extends { score: number; id: string }>(a: T, b: T): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.id.localeCompare(b.id);
}
