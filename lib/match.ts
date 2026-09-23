import { CONTRACTORS, priceRange } from './catalog';
import { estimateTravelCost } from './travel';
import { assignDifferentiators } from './differentiators';
import { applyFilters } from './filters';
import { collectRelaxations, nearestCandidates, suggestBetterDate, type RelaxHit } from './relax';
import { buildFacts, byScoreThenId, checkWishes, scoreParts, totalScore, type WishVectors } from './scoring';
import type { Card, Contractor, MatchRequest, MatchResponse } from './types';

const MAX_CARDS_ON_SCREEN = 3;

function money(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₸`;
}

/** Русские склонения: 1 подрядчик, 2 подрядчика, 5 подрядчиков. */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * Проезд считается для любой карточки из другого города, а не только для правила FLY_IN:
 * в блоке «ближайшее» тоже попадаются подрядчики из соседнего города.
 */
function withTravel(hit: RelaxHit, req: MatchRequest): NonNullable<Card['relaxation']> {
  return {
    rule: hit.rule,
    label: hit.label,
    detail: hit.detail,
    travel:
      hit.contractor.city !== req.city
        ? estimateTravelCost(hit.contractor.city, req.city, req.date, req.category)
        : undefined,
  };
}

function toCard(c: Contractor, req: MatchRequest, pool: Contractor[], vectors?: WishVectors): Card {
  const checks = checkWishes(c, req.wishes, vectors);
  const parts = scoreParts(c, req, checks);
  return {
    id: c.id,
    name: c.name,
    category: req.category,
    city: c.city,
    priceFromKzt: c.priceFromKzt,
    score: totalScore(parts, checks.length > 0),
    parts,
    facts: buildFacts(c, req, pool, checks),
    differentiators: [],
  };
}

/** Текст для любого исхода — считается кодом, а не моделью: числа обязаны быть точными. */
function buildMessage(req: MatchRequest, res: Omit<MatchResponse, 'message'>): string {
  const f = (step: string) => res.funnel.find((x) => x.step === step);
  const inCity = f('категория')?.after ?? 0;
  const byFormat = f('формат')?.after ?? 0;
  const busy = f('свободен')?.dropped ?? 0;
  const overBudget = f('бюджет')?.dropped ?? 0;

  switch (res.outcome) {
    case 'NO_CATEGORY_IN_CITY': {
      const elsewhere = CONTRACTORS.filter(
        (c) => c.categories.includes(req.category) && c.city !== req.city,
      );
      const cities = [...new Set(elsewhere.map((c) => c.city))].join(' и ');
      return elsewhere.length
        ? `В каталоге нет категории «${req.category}» в городе ${req.city}. ` +
            `Всего таких подрядчиков ${elsewhere.length}, и все они в ${cities}.`
        : `В каталоге вообще нет подрядчиков категории «${req.category}».`;
    }
    case 'NO_FORMAT_IN_POOL': {
      const pool = CONTRACTORS.filter(
        (c) => c.city === req.city && c.categories.includes(req.category),
      );
      const formats = [...new Set(pool.flatMap((c) => c.eventFormats))].join(', ');
      return (
        `В городе ${req.city} в категории «${req.category}» ${plural(pool.length, 'подрядчик', 'подрядчика', 'подрядчиков')}, ` +
        `но формат «${req.eventFormat}» не берёт ни один. Они работают с форматами: ${formats}.`
      );
    }
    case 'NO_ONE_PASSES': {
      const parts = [
        busy ? `${plural(busy, 'занят', 'заняты', 'заняты')} ${req.date}` : '',
        overBudget ? `у ${plural(overBudget, 'подрядчика', 'подрядчиков', 'подрядчиков')} цена выше бюджета ${money(req.budgetKzt ?? 0)}` : '',
      ].filter(Boolean);
      const better = suggestBetterDate(req);
      const tail = better
        ? ` Если дата гибкая: ${better.date} подходящих ${better.count}.`
        : '';
      return (
        `В городе ${req.city} формат «${req.eventFormat ?? 'любой'}» в категории «${req.category}» берут ${byFormat}. ` +
        `Из них ${parts.join(', ')}. Никто не проходит по всем условиям.${tail}`
      );
    }
    default: {
      const shown = res.cards.length;
      const head = `Подобрали ${shown} из ${byFormat}, кто берёт «${req.eventFormat ?? 'ваш формат'}» в городе ${req.city}.`;
      if (shown >= 3) {
        const why = [busy ? `${plural(busy, 'занят', 'заняты', 'заняты')} на дату` : '', overBudget ? `у ${plural(overBudget, 'подрядчика', 'подрядчиков', 'подрядчиков')} цена выше бюджета` : '']
          .filter(Boolean)
          .join(', ');
        return why ? `${head} Отсеяны: ${why}.` : head;
      }
      const why = [
        busy ? `${plural(busy, 'занят', 'заняты', 'заняты')} ${req.date}` : '',
        overBudget ? `у ${plural(overBudget, 'подрядчика', 'подрядчиков', 'подрядчиков')} цена выше бюджета` : '',
        inCity < 3 ? `в каталоге всего ${plural(inCity, 'подрядчик', 'подрядчика', 'подрядчиков')} этой категории в городе` : '',
      ].filter(Boolean);
      const better = suggestBetterDate(req);
      return (
        `${head} Меньше трёх, потому что ${why.join('; ')}.` +
        (better ? ` Если дата гибкая: ${better.date} подходящих ${better.count}.` : '')
      );
    }
  }
}

export function match(req: MatchRequest, wishVectors?: WishVectors): MatchResponse {
  const started = Date.now();
  const filtered = applyFilters(req);

  const pool = filtered.survivors;
  const ranked = pool
    .map((c) => toCard(c, req, pool, wishVectors))
    .sort(byScoreThenId)
    .slice(0, MAX_CARDS_ON_SCREEN);

  const descriptions = Object.fromEntries(CONTRACTORS.map((c) => [c.id, c.description]));
  const cards = assignDifferentiators(ranked, descriptions);

  // Послабления занимают только свободные места на экране: всего не больше трёх карточек.
  const slots = MAX_CARDS_ON_SCREEN - cards.length;
  const hits = collectRelaxations(req, cards.map((c) => c.id), slots);
  const softRanked = hits.map((hit) => {
    const card = toCard(hit.contractor, req, hits.map((h) => h.contractor), wishVectors);
    return { ...card, relaxation: withTravel(hit, req) };
  });
  const softCards = assignDifferentiators(softRanked, descriptions).map((c, i) => ({
    ...c,
    relaxation: softRanked[i].relaxation,
  }));

  // Если не прошёл вообще никто — показываем ближайшее, что есть в каталоге,
  // с честной величиной расхождения. Пустой экран бесполезен.
  const nearestHits =
    cards.length === 0
      ? nearestCandidates(req, [...cards, ...softCards].map((c) => c.id), MAX_CARDS_ON_SCREEN - softCards.length)
      : [];
  const nearestRanked = nearestHits.map((hit) => {
    const card = toCard(hit.contractor, req, nearestHits.map((h) => h.contractor), wishVectors);
    return { ...card, relaxation: withTravel(hit, req) };
  });
  const nearestCards = assignDifferentiators(nearestRanked, descriptions).map((c, i) => ({
    ...c,
    relaxation: nearestRanked[i].relaxation,
  }));

  const notes: string[] = [];
  if (!req.budgetKzt) {
    const r = priceRange(req.category, req.city);
    notes.push(
      r
        ? `Бюджет не указан — показываю самых подходящих по остальным параметрам. Цены в этой категории: ${money(r.min)} – ${money(r.max)}.`
        : 'Бюджет не указан — фильтр по цене не применялся.',
    );
  }
  if (req.language && !cards.length) notes.push('Язык учитывался как пожелание, а не как жёсткий фильтр.');
  if ([...cards, ...softCards, ...nearestCards].some((c) => c.facts.synthetic)) {
    notes.push('В выдаче есть профили, помеченные в датасете как синтетические — они отмечены в карточке.');
  }
  if ([...cards, ...softCards, ...nearestCards].some((c) => c.facts.priceImputed)) {
    notes.push('У части профилей цена в каталоге ориентировочная, а не заявленная подрядчиком.');
  }

  const partial: Omit<MatchResponse, 'message'> = {
    outcome: filtered.outcome,
    cards,
    softCards,
    nearestCards,
    funnel: filtered.funnel,
    nearMisses: filtered.nearMisses.slice(0, 3),
    request: req,
    notes,
    timings: { totalMs: Date.now() - started },
  };

  return { ...partial, message: buildMessage(req, partial) };
}
