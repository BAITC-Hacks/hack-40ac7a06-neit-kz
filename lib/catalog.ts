import contractorsJson from '@/data/contractors.json';
import metaJson from '@/data/meta.json';
import type { Contractor } from './types';

export const CONTRACTORS = contractorsJson as Contractor[];

export const META = metaJson as {
  /** размер каталога: показывается в шапке, сверяется в npm run stats */
  profiles: number;
  categories: string[];
  eventFormats: string[];
  languages: string[];
  cities: string[];
  dateWindow: { from: string; to: string };
  priceRanges: Record<string, { n: number; min: number; max: number }>;
  /** категории, где дату работы можно сдвинуть назад; число — на сколько дней */
  softDateCategories: Record<string, number>;
  venueCategories: string[];
  langCriticalCategories: string[];
  formatNeighbours: Record<string, string>;
};

/** Язык — жёсткий фильтр только там, где продукт это речь и вокал. */
export function isLanguageCritical(category: string): boolean {
  return META.langCriticalCategories.includes(category);
}

export function isVenue(category: string): boolean {
  return META.venueCategories.includes(category);
}

/** Сколько дней назад можно сдвинуть работу подрядчика. 0 — сдвиг запрещён. */
export function softDateWindow(category: string): number {
  return META.softDateCategories[category] ?? 0;
}

/**
 * Медианная цена категории — основание для деления общего бюджета между позициями.
 * Сначала по городу клиента, при пустом наборе — по всему каталогу.
 */
export function medianPrice(category: string, city?: string): number | undefined {
  const inCity = city
    ? CONTRACTORS.filter((c) => c.categories.includes(category) && c.city === city)
    : [];
  const pool = inCity.length ? inCity : CONTRACTORS.filter((c) => c.categories.includes(category));
  if (pool.length === 0) return undefined;
  const prices = pool.map((c) => c.priceFromKzt).sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}

export function priceRange(category: string, city: string) {
  return META.priceRanges[`${category}|${city}`];
}

/**
 * Ресторан, Отель и Загородная площадка — подмножества Банкетного зала,
 * Национальный ансамбль совпадает с Танцевальным коллективом.
 * Показываем это в карточке, иначе два разных запроса выглядят как баг.
 */
export function alsoListedAs(c: Contractor, requested: string): string[] {
  return c.categories.filter((x) => x !== requested);
}

/** Даты сравниваем строками: 'YYYY-MM-DD' сортируется лексикографически. */
export function isFree(c: Contractor, date: string): boolean {
  return !c.busyDates.includes(date);
}

export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const dt = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Ближайшая свободная дата после указанной, в пределах окна датасета. */
export function nextFreeDate(c: Contractor, from: string): string | undefined {
  for (let i = 1; i <= 100; i++) {
    const d = shiftDate(from, i);
    if (d > META.dateWindow.to) return undefined;
    if (isFree(c, d)) return d;
  }
  return undefined;
}
