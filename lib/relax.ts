import { CONTRACTORS, META, isFree, isVenue, priceRange, shiftDate, softDateWindow } from './catalog';
import type { Contractor, MatchRequest } from './types';

/**
 * Блок «ещё может подойти, если…».
 *
 * Инвариант: основная выдача — только те, кто прошёл ВСЕ жёсткие условия.
 * Послабления живут отдельным массивом и появляются, только если основных меньше трёх.
 * На экране всего не больше трёх карточек, считая послабления.
 *
 * Формулировка, которая отличает послабление от подмены ответа:
 * мы не двигаем дату мероприятия клиента — мы двигаем дату РАБОТЫ подрядчика.
 */

export type RelaxRule =
  | 'NEAREST'
  | 'SOFT_DATE'
  | 'NEIGHBOUR_FORMAT'
  | 'FLY_IN'
  | 'BUDGET_STRETCH'
  | 'DURATION_STRETCH';

export type RelaxHit = {
  contractor: Contractor;
  rule: RelaxRule;
  label: string;
  detail: string;
};

const FLY_IN_MIN_FEE = 1_000_000;

/** Предложный падеж города: «не в Астане», а не «не в Астана». */
const CITY_IN: Record<string, string> = {
  'Алматы': 'Алматы',
  'Астана': 'Астане',
  'Зарубежье': 'Зарубежье',
};
const cityIn = (city: string): string => CITY_IN[city] ?? city;

/** «в 4,5 раза» / «в 5 раз» — без «в 5,0 раза». */
function timesLabel(times: number): string {
  const rounded = Math.round(times * 10) / 10;
  if (Number.isInteger(rounded)) {
    const n = rounded % 100;
    const tail = n >= 5 && n <= 20 ? 'раз' : [0, 1].includes(n % 10) ? 'раза' : n % 10 <= 4 ? 'раза' : 'раз';
    return `в ${rounded} ${tail}`;
  }
  return `в ${rounded.toFixed(1).replace('.', ',')} раза`;
}

function passesBase(c: Contractor, req: MatchRequest, opts: { skipDate?: boolean; skipCity?: boolean; skipFormat?: boolean; skipBudget?: boolean } = {}): boolean {
  if (!opts.skipCity && c.city !== req.city) return false;
  if (!c.categories.includes(req.category)) return false;
  if (!opts.skipFormat && req.eventFormat && !c.eventFormats.includes(req.eventFormat)) return false;
  if (!opts.skipDate && !isFree(c, req.date)) return false;
  if (!opts.skipBudget && req.budgetKzt && c.priceFromKzt > req.budgetKzt) return false;
  return true;
}

/** 1. Мягкая дата: только категории без лимита часов, только назад. */
function softDate(req: MatchRequest, exclude: Set<string>): RelaxHit[] {
  const window = softDateWindow(req.category);
  if (window === 0) return [];
  const hits: RelaxHit[] = [];
  for (const c of CONTRACTORS) {
    if (exclude.has(c.id)) continue;
    if (!passesBase(c, req, { skipDate: true })) continue;
    if (isFree(c, req.date)) continue; // свободные уже в основной выдаче
    const free: string[] = [];
    for (let d = 1; d <= window; d++) {
      const day = shiftDate(req.date, -d);
      if (day >= META.dateWindow.from && isFree(c, day)) free.push(day);
    }
    if (free.length === 0) continue;
    hits.push({
      contractor: c,
      rule: 'SOFT_DATE',
      label: 'сдвиг работы на день раньше',
      detail:
        `Занят ${req.date}, но свободен ${free.join(' и ')}. ` +
        `В профиле нет лимита часов на площадке — работа не привязана к присутствию. ` +
        `Дата вашего мероприятия не меняется, меняется день работы подрядчика.`,
    });
  }
  return hits;
}

/** 2. Формат-сосед: только направления со стопроцентной совместной встречаемостью. */
function neighbourFormat(req: MatchRequest, exclude: Set<string>): RelaxHit[] {
  if (!req.eventFormat) return [];
  const neighbour = META.formatNeighbours[req.eventFormat];
  if (!neighbour) return [];
  const hits: RelaxHit[] = [];
  for (const c of CONTRACTORS) {
    if (exclude.has(c.id)) continue;
    if (!passesBase(c, req, { skipFormat: true })) continue;
    if (c.eventFormats.includes(req.eventFormat)) continue;
    if (!c.eventFormats.includes(neighbour)) continue;
    // той → свадьба разрешаем только со знанием казахского: иначе это подмена, а не послабление
    if (req.eventFormat === 'той' && !c.languages.includes('казахский')) continue;
    hits.push({
      contractor: c,
      rule: 'NEIGHBOUR_FORMAT',
      label: `берёт «${neighbour}», а не «${req.eventFormat}»`,
      detail:
        `В анкете указан формат «${neighbour}». В каталоге все, кто берёт «${req.eventFormat}», ` +
        `берут и «${neighbour}» — форматы соседние. Уточните, работает ли он с «${req.eventFormat}».`,
    });
  }
  return hits;
}

/** 3. Перелёт: мобильные категории с чеком от миллиона. Площадки и «Зарубежье» исключены. */
function flyIn(req: MatchRequest, exclude: Set<string>): RelaxHit[] {
  if (isVenue(req.category)) return [];
  const hits: RelaxHit[] = [];
  for (const c of CONTRACTORS) {
    if (exclude.has(c.id)) continue;
    if (c.city === req.city || c.city === 'Зарубежье') continue;
    if (!passesBase(c, req, { skipCity: true })) continue;
    if (c.priceFromKzt < FLY_IN_MIN_FEE) continue;
    hits.push({
      contractor: c,
      rule: 'FLY_IN',
      label: `работает в городе ${c.city}`,
      detail:
        `В городе ${req.city} на ${req.date} подходящих нет, а он свободен. ` +
        `Гонорар ${c.priceFromKzt.toLocaleString('ru-RU')} ₸ — перелёт и проживание считаются отдельной строкой сметы ` +
        `и в цену не входят. Для коллектива расходы умножаются на состав.`,
    });
  }
  return hits;
}

/** 4. Бюджет: +15%, если цена оценочная, +10%, если заявлена подрядчиком. */
function budgetStretch(req: MatchRequest, exclude: Set<string>): RelaxHit[] {
  if (!req.budgetKzt) return [];
  const hits: RelaxHit[] = [];
  for (const c of CONTRACTORS) {
    if (exclude.has(c.id)) continue;
    if (!passesBase(c, req, { skipBudget: true })) continue;
    if (c.priceFromKzt <= req.budgetKzt) continue;
    const limit = req.budgetKzt * (c.priceImputed ? 1.15 : 1.1);
    if (c.priceFromKzt > limit) continue;
    const over = c.priceFromKzt - req.budgetKzt;
    const pct = Math.round((over / req.budgetKzt) * 100);
    hits.push({
      contractor: c,
      rule: 'BUDGET_STRETCH',
      label: `дороже бюджета на ${pct}%`,
      detail:
        `${c.priceFromKzt.toLocaleString('ru-RU')} ₸ против вашего ${req.budgetKzt.toLocaleString('ru-RU')} ₸ ` +
        `— превышение ${over.toLocaleString('ru-RU')} ₸. Цена указана «от»` +
        (c.priceImputed ? ', и в каталоге она ориентировочная — уточните прайс.' : '.'),
    });
  }
  return hits;
}

/** 5. Длительность: берёт на 2 часа меньше запрошенного. */
function durationStretch(req: MatchRequest, exclude: Set<string>): RelaxHit[] {
  if (!req.durationHours) return [];
  const hits: RelaxHit[] = [];
  for (const c of CONTRACTORS) {
    if (exclude.has(c.id)) continue;
    if (!passesBase(c, req)) continue;
    if (c.maxHours === null || c.maxHours >= req.durationHours) continue;
    if (c.maxHours < req.durationHours - 2) continue;
    hits.push({
      contractor: c,
      rule: 'DURATION_STRETCH',
      label: `берёт до ${c.maxHours} ч вместо ${req.durationHours}`,
      detail: `В анкете максимум ${c.maxHours} часов на площадке. Переработка обычно обсуждается отдельно.`,
    });
  }
  return hits;
}

/** Фиксированный порядок правил — часть гарантии детерминизма. */
const RULE_ORDER: RelaxRule[] = ['SOFT_DATE', 'NEIGHBOUR_FORMAT', 'FLY_IN', 'BUDGET_STRETCH', 'DURATION_STRETCH'];

export function collectRelaxations(req: MatchRequest, alreadyShown: string[], slots: number): RelaxHit[] {
  if (slots <= 0) return [];
  const exclude = new Set(alreadyShown);
  const all = [
    ...softDate(req, exclude),
    ...neighbourFormat(req, exclude),
    ...flyIn(req, exclude),
    ...budgetStretch(req, exclude),
    ...durationStretch(req, exclude),
  ];

  const perRule = new Map<RelaxRule, RelaxHit[]>();
  for (const hit of all) {
    const list = perRule.get(hit.rule) ?? [];
    list.push(hit);
    perRule.set(hit.rule, list);
  }

  const out: RelaxHit[] = [];
  for (const rule of RULE_ORDER) {
    const list = (perRule.get(rule) ?? []).sort((a, b) =>
      a.contractor.priceFromKzt === b.contractor.priceFromKzt
        ? a.contractor.id.localeCompare(b.contractor.id)
        : a.contractor.priceFromKzt - b.contractor.priceFromKzt,
    );
    for (const hit of list.slice(0, 2)) {
      if (out.length >= slots) return out;
      out.push(hit);
    }
  }
  return out;
}

/**
 * Ближайшие по параметрам — когда не проходит вообще никто.
 *
 * Показываем то, что есть в каталоге, с честной величиной расхождения:
 * «дороже бюджета в 4,5 раза», «свободен 14 декабря — на день раньше».
 * Это не подмена ответа: карточки идут отдельным блоком и каждая называет свою цену компромисса.
 */
export function nearestCandidates(req: MatchRequest, alreadyShown: string[], limit: number): RelaxHit[] {
  if (limit <= 0) return [];
  const exclude = new Set(alreadyShown);

  let pool = CONTRACTORS.filter((c) => !exclude.has(c.id) && c.categories.includes(req.category));
  if (pool.length === 0) return [];

  const scored = pool.map((c) => {
    const gaps: string[] = [];
    let distance = 0;

    if (req.budgetKzt && c.priceFromKzt > req.budgetKzt) {
      const over = c.priceFromKzt - req.budgetKzt;
      const times = c.priceFromKzt / req.budgetKzt;
      distance += over / req.budgetKzt;
      gaps.push(
        times >= 2
          ? `дороже бюджета ${timesLabel(times)} (${c.priceFromKzt.toLocaleString('ru-RU')} ₸ против ${req.budgetKzt.toLocaleString('ru-RU')} ₸)`
          : `дороже бюджета на ${over.toLocaleString('ru-RU')} ₸`,
      );
    }

    if (!isFree(c, req.date)) {
      const shift = nearestFreeShift(c, req.date);
      if (shift === undefined) {
        distance += 5;
        gaps.push('занят и в ближайшую неделю до и после даты');
      } else {
        distance += Math.abs(shift) * 0.15;
        const day = shiftDate(req.date, shift);
        gaps.push(
          shift < 0
            ? `занят ${req.date}, свободен ${day} — на ${Math.abs(shift)} дн. раньше`
            : `занят ${req.date}, свободен ${day} — на ${shift} дн. позже`,
        );
      }
    }

    if (req.eventFormat && !c.eventFormats.includes(req.eventFormat)) {
      distance += 0.6;
      gaps.push(`в анкете нет формата «${req.eventFormat}», указаны: ${c.eventFormats.join(', ')}`);
    }

    if (c.city !== req.city) {
      distance += 0.8;
      gaps.push(`работает в городе ${c.city}, не в ${cityIn(req.city)}`);
    }

    if (req.durationHours && c.maxHours !== null && c.maxHours < req.durationHours) {
      distance += 0.3;
      gaps.push(`берёт до ${c.maxHours} ч вместо ${req.durationHours}`);
    }

    return { c, distance, gaps };
  });

  scored.sort((a, b) =>
    a.distance === b.distance ? a.c.id.localeCompare(b.c.id) : a.distance - b.distance,
  );

  return scored.slice(0, limit).map(({ c, gaps }) => ({
    contractor: c,
    rule: 'NEAREST' as const,
    label: gaps.length ? 'ближайший вариант с оговорками' : 'ближайший вариант',
    detail: gaps.length
      ? `Под ваши условия не подходит: ${gaps.join('; ')}.`
      : 'Подходит по всем параметрам, кроме тех, что мы не проверяли.',
  }));
}

/** Сдвиг до ближайшей свободной даты в пределах недели: назад приоритетнее. */
function nearestFreeShift(c: Contractor, date: string): number | undefined {
  for (let d = 1; d <= 7; d++) {
    for (const shift of [-d, d]) {
      const day = shiftDate(date, shift);
      if (day < META.dateWindow.from || day > META.dateWindow.to) continue;
      if (isFree(c, day)) return shift;
    }
  }
  return undefined;
}

/** Подсказка для гибкого по дате клиента: когда выдача станет полной. */
export function suggestBetterDate(req: MatchRequest): { date: string; count: number } | undefined {
  for (let d = 1; d <= 21; d++) {
    for (const day of [shiftDate(req.date, d), shiftDate(req.date, -d)]) {
      if (day < META.dateWindow.from || day > META.dateWindow.to) continue;
      const n = CONTRACTORS.filter(
        (c) =>
          c.city === req.city &&
          c.categories.includes(req.category) &&
          (!req.eventFormat || c.eventFormats.includes(req.eventFormat)) &&
          (!req.budgetKzt || c.priceFromKzt <= req.budgetKzt) &&
          isFree(c, day),
      ).length;
      if (n >= 3) return { date: day, count: n };
    }
  }
  return undefined;
}

export { priceRange };
