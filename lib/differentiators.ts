import type { Card, Differentiator } from './types';

/**
 * Чем карточки отличаются ДРУГ ОТ ДРУГА. Различие ищется в данных до обращения
 * к модели — модель потом только переводит его в русский текст.
 *
 * Три яруса, сверху вниз до первого сработавшего:
 *   1. поля профиля (цена, часы, языки, состав форматов, календарь);
 *   2. уникальные термины из описания — когда поля совпадают (тройка ансамблей);
 *   3. честное признание сходства — когда совпадают и тексты (пара лайв-бэндов).
 */

const STOP = new Set([
  'для', 'что', 'как', 'это', 'наш', 'наши', 'вас', 'ваш', 'ваше', 'вашего', 'мероприятия',
  'мероприятие', 'мероприятий', 'работаем', 'работает', 'также', 'более', 'все', 'всех',
  'при', 'под', 'над', 'без', 'или', 'его', 'их', 'том', 'так', 'уже', 'ещё', 'еще',
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

type AxisSpec = {
  axis: string;
  value: (c: Card) => string | number | undefined;
  label: (c: Card) => string;
};

const AXES: AxisSpec[] = [
  {
    axis: 'price',
    value: (c) => c.priceFromKzt,
    label: (c) => `цена ${c.priceFromKzt.toLocaleString('ru-RU')} ₸`,
  },
  {
    axis: 'hours',
    value: (c) => c.facts.hoursSpare,
    label: (c) =>
      c.facts.hoursSpare !== undefined ? `запас ${c.facts.hoursSpare} ч сверх вашей программы` : '',
  },
  {
    axis: 'languages',
    value: (c) => c.facts.languages.join('+'),
    label: (c) => `языки: ${c.facts.languages.join(', ')}`,
  },
  {
    axis: 'formats',
    value: (c) => c.facts.formatsCount,
    label: (c) =>
      c.facts.formatsCount <= 2
        ? `узкий специалист: берёт всего ${c.facts.formatsCount} формата`
        : `берёт ${c.facts.formatsCount} форматов из 6`,
  },
  {
    axis: 'experience',
    value: (c) => c.facts.experienceClaims.join('|') || undefined,
    label: (c) => c.facts.experienceClaims.join(', '),
  },
];

/**
 * @param cards карточки одной выдачи
 * @param descriptions id → текст описания профиля
 */
export function assignDifferentiators(cards: Card[], descriptions: Record<string, string>): Card[] {
  if (cards.length <= 1) {
    return cards.map((c) => {
      const diffs: Differentiator[] = [];
      if (c.facts.experienceClaims.length) {
        diffs.push({ axis: 'experience', value: c.facts.experienceClaims.join(', '), tier: 1 });
      }
      const own = descriptions[c.id] ?? '';
      const phrase = uniqueTermPhrase(own, words(own));
      if (phrase) diffs.push({ axis: 'description', value: phrase, tier: 2 });
      return { ...c, differentiators: diffs };
    });
  }

  const used = new Set<string>();

  return cards.map((card) => {
    const diffs: Differentiator[] = [];

    // Ярус 1: поле, значение которого уникально внутри выдачи
    for (const spec of AXES) {
      if (diffs.length >= 2) break;
      const v = spec.value(card);
      if (v === undefined || v === '') continue;
      const unique = cards.filter((o) => spec.value(o) === v).length === 1;
      const key = `${spec.axis}:${String(v)}`;
      if (!unique || used.has(key)) continue;
      const label = spec.label(card);
      if (!label) continue;
      used.add(key);
      diffs.push({ axis: spec.axis, value: label, tier: 1 });
    }

    // Ярус 2: фраза из описания с термином, которого нет у других карточек выдачи
    if (diffs.length < 2) {
      const own = descriptions[card.id] ?? '';
      const otherWords = new Set(
        cards.filter((o) => o.id !== card.id).flatMap((o) => words(descriptions[o.id] ?? '')),
      );
      const uniqueWords = words(own).filter((w) => !otherWords.has(w));
      const phrase = uniqueTermPhrase(own, uniqueWords);
      if (phrase) diffs.push({ axis: 'description', value: phrase, tier: 2 });
    }

    // Ярус 3: честное признание сходства
    if (diffs.length === 0) {
      diffs.push({
        axis: 'similarity',
        value: 'предложение почти не отличается от соседнего в выдаче — разницу стоит уточнить напрямую',
        tier: 3,
      });
    }

    return { ...card, differentiators: diffs };
  });
}

/** Короткое предложение из описания вокруг уникального слова — улика для объяснения. */
function uniqueTermPhrase(description: string, uniqueWords: string[]): string | undefined {
  if (!description || uniqueWords.length === 0) return undefined;
  const sentences = description
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Предпочитаем предложения с фактами: числа, имена собственные, длина.
  // Иначе уликой становится «Приветствую всех, дорогие друзья!» — а это не факт.
  const scored = sentences
    .filter((s) => words(s).some((x) => uniqueWords.includes(x)))
    .map((s) => {
      let rank = 0;
      if (/\d/.test(s)) rank += 3;
      if (/[А-ЯA-Z][а-яa-z]{2,}/.test(s.slice(1))) rank += 2;
      if (s.length > 60) rank += 1;
      if (/^(привет|здравствуй|добрый)/i.test(s)) rank -= 3;
      return { s, rank };
    })
    .sort((a, b) => (b.rank === a.rank ? a.s.localeCompare(b.s) : b.rank - a.rank));
  const best = scored[0]?.s;
  if (!best) return undefined;
  return best.length > 140 ? `${best.slice(0, 137)}…` : best;
}
