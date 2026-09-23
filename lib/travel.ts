import flights from '@/data/flights.json';
import { shiftDate } from './catalog';

/**
 * Стоимость проезда подрядчика из другого города.
 *
 * Снимок цен лежит в репозитории (`data/flights.json`), живого вызова в рантайме нет:
 * ядро обязано оставаться чистой функцией без сети, а демо — не зависеть от вайфая.
 * В полноценной реализации это живой вызов с кэшем на несколько часов; врезка —
 * только тело `estimateTravelCost`, интерфейс функции не меняется.
 *
 * Возраст снимка здесь НЕ проверяется: это единственное место, где ядро читало бы
 * системные часы, и тогда `npm run verify` начал бы падать сам собой через месяц.
 */

export type TravelBasis = 'exact' | 'nearby' | 'median';

export type TravelCost = {
  /** туда + обратно на одного человека */
  perPersonKzt: number;
  headcount: number;
  totalKzt: number;
  /** худший из двух плеч: median хуже nearby хуже exact */
  basis: TravelBasis;
  basisNote: string;
  snapshotAt: string;
};

export type FlightSnapshot = {
  snapshotAt: string;
  source: string;
  currency: string;
  oneWay: boolean;
  routes: Record<string, Record<string, number>>;
  monthMedian: Record<string, Record<string, number>>;
};

const SNAPSHOT = flights as FlightSnapshot;

const IATA: Record<string, string> = {
  'Алматы': 'ALA',
  'Астана': 'NQZ',
};

/**
 * Состав — допущение, а не данные: поля о числе участников в датасете нет.
 * Категория вне таблицы даёт undefined: молча посчитать танцевальный коллектив
 * как одного человека хуже, чем не считать вовсе.
 */
const HEADCOUNT: Record<string, number> = {
  'Ведущий': 1,
  'Лайв-бэнд': 5,
};

const NEARBY_DAYS = 3;
const BASIS_RANK: Record<TravelBasis, number> = { exact: 0, nearby: 1, median: 2 };

type LegPrice = { price: number; basis: TravelBasis; note: string };

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Лестница по одному плечу: точная дата → ближайшая в пределах ±3 дней → медиана месяца. */
function legPrice(snapshot: FlightSnapshot, route: string, date: string): LegPrice | undefined {
  const daily = snapshot.routes[route];
  if (daily?.[date] !== undefined) {
    return { price: daily[date], basis: 'exact', note: 'цена дня мероприятия' };
  }

  if (daily) {
    for (let d = 1; d <= NEARBY_DAYS; d++) {
      for (const shift of [-d, d]) {
        const day = shiftDate(date, shift);
        if (daily[day] !== undefined) {
          return { price: daily[day], basis: 'nearby', note: `цена ближайшего дня (${day})` };
        }
      }
    }
  }

  const median = snapshot.monthMedian[route]?.[monthKey(date)];
  if (median !== undefined) {
    return { price: median, basis: 'median', note: 'медиана месяца — цены на этот день в снимке нет' };
  }
  return undefined;
}

/** Та же логика, но на переданном снимке — нужна тестам и будущему живому источнику. */
export function computeTravel(
  snapshot: FlightSnapshot,
  fromCity: string,
  toCity: string,
  date: string,
  category: string,
): TravelCost | undefined {
  const from = IATA[fromCity];
  const to = IATA[toCity];
  if (!from || !to || from === to) return undefined;

  const headcount = HEADCOUNT[category];
  if (!headcount) return undefined;

  const outbound = legPrice(snapshot, `${from}-${to}`, date);
  const inbound = legPrice(snapshot, `${to}-${from}`, date);
  if (!outbound || !inbound) return undefined;

  const basis: TravelBasis =
    BASIS_RANK[outbound.basis] >= BASIS_RANK[inbound.basis] ? outbound.basis : inbound.basis;
  const perPersonKzt = outbound.price + inbound.price;

  return {
    perPersonKzt,
    headcount,
    totalKzt: perPersonKzt * headcount,
    basis,
    basisNote: basis === 'exact' ? outbound.note : basis === 'nearby' ? 'цена ближайшего дня' : 'медиана месяца',
    snapshotAt: snapshot.snapshotAt,
  };
}

export function estimateTravelCost(
  fromCity: string,
  toCity: string,
  date: string,
  category: string,
): TravelCost | undefined {
  return computeTravel(SNAPSHOT, fromCity, toCity, date, category);
}

export const TRAVEL_SNAPSHOT = SNAPSHOT;
export const TRAVEL_HEADCOUNT = HEADCOUNT;
