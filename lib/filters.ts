import { CONTRACTORS, isFree, isLanguageCritical } from './catalog';
import type { Contractor, FunnelStep, MatchRequest, NearMiss, Outcome } from './types';

export type FilterResult = {
  survivors: Contractor[];
  funnel: FunnelStep[];
  nearMisses: NearMiss[];
  outcome: Outcome;
  /** пул после города и категории — нужен для релаксации и объяснений */
  cityCategoryPool: Contractor[];
  formatPool: Contractor[];
};

function step(
  name: string,
  before: Contractor[],
  after: Contractor[],
  reason: string,
): FunnelStep {
  return {
    step: name,
    before: before.length,
    after: after.length,
    dropped: before.length - after.length,
    reason,
  };
}

/**
 * Семь жёстких фильтров в фиксированном порядке. Каждый шаг пишет в воронку,
 * сколько отсеял и почему — воронка возвращается в ответе всегда.
 */
export function applyFilters(req: MatchRequest): FilterResult {
  const funnel: FunnelStep[] = [];
  const nearMisses: NearMiss[] = [];

  // 1. Город
  const all = CONTRACTORS;
  const byCity = all.filter((c) => c.city === req.city);
  funnel.push(step('город', all, byCity, `город «${req.city}»`));

  // 2. Категория
  const byCategory = byCity.filter((c) => c.categories.includes(req.category));
  funnel.push(step('категория', byCity, byCategory, `категория «${req.category}»`));

  if (byCategory.length === 0) {
    return {
      survivors: [],
      funnel,
      nearMisses,
      outcome: 'NO_CATEGORY_IN_CITY',
      cityCategoryPool: [],
      formatPool: [],
    };
  }

  // 3. Формат мероприятия
  const byFormat = req.eventFormat
    ? byCategory.filter((c) => c.eventFormats.includes(req.eventFormat!))
    : byCategory;
  funnel.push(
    step('формат', byCategory, byFormat, req.eventFormat ? `берёт «${req.eventFormat}»` : 'формат не указан'),
  );

  if (byFormat.length === 0) {
    return {
      survivors: [],
      funnel,
      nearMisses,
      outcome: 'NO_FORMAT_IN_POOL',
      cityCategoryPool: byCategory,
      formatPool: [],
    };
  }

  // 4. Свободен на дату
  const byDate = byFormat.filter((c) => isFree(c, req.date));
  funnel.push(step('свободен', byFormat, byDate, `свободен ${req.date}`));
  for (const c of byFormat) {
    if (!isFree(c, req.date)) {
      nearMisses.push({ id: c.id, name: c.name, droppedAt: 'свободен', reason: `занят ${req.date}` });
    }
  }

  // 5. Бюджет (если назван)
  const byBudget = req.budgetKzt
    ? byDate.filter((c) => c.priceFromKzt <= req.budgetKzt!)
    : byDate;
  funnel.push(
    step(
      'бюджет',
      byDate,
      byBudget,
      req.budgetKzt ? `цена до ${req.budgetKzt.toLocaleString('ru-RU')} ₸` : 'бюджет не указан',
    ),
  );
  if (req.budgetKzt) {
    for (const c of byDate) {
      if (c.priceFromKzt > req.budgetKzt) {
        nearMisses.push({
          id: c.id,
          name: c.name,
          droppedAt: 'бюджет',
          reason: `${c.priceFromKzt.toLocaleString('ru-RU')} ₸ при вашем ${req.budgetKzt.toLocaleString('ru-RU')} ₸`,
        });
      }
    }
  }

  // 6. Язык — жёстко только там, где продукт это речь и вокал
  const langHard = req.language ? isLanguageCritical(req.category) : false;
  const byLanguage = langHard
    ? byBudget.filter((c) => c.languages.includes(req.language!))
    : byBudget;
  funnel.push(
    step(
      'язык',
      byBudget,
      byLanguage,
      langHard
        ? `работает на языке «${req.language}»`
        : req.language
          ? `язык «${req.language}» учтён как пожелание, а не как фильтр`
          : 'язык не указан',
    ),
  );

  // 7. Длительность. maxHours = null — работа не привязана к присутствию, проходит всегда.
  const byDuration = req.durationHours
    ? byLanguage.filter((c) => c.maxHours === null || c.maxHours >= req.durationHours!)
    : byLanguage;
  funnel.push(
    step(
      'длительность',
      byLanguage,
      byDuration,
      req.durationHours ? `берёт от ${req.durationHours} ч (без лимита часов — проходит)` : 'длительность не указана',
    ),
  );

  return {
    survivors: byDuration,
    funnel,
    nearMisses,
    outcome: byDuration.length > 0 ? 'MATCHED' : 'NO_ONE_PASSES',
    cityCategoryPool: byCategory,
    formatPool: byFormat,
  };
}
