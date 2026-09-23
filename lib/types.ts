import type { TravelCost } from './travel';

// Типы домена. Одно правило на весь проект: даты — строки 'YYYY-MM-DD',
// объект Date в фильтрах не используется (парсинг уезжает в UTC и сдвигает день).

export type Contractor = {
  id: string;
  name: string;
  categories: string[];
  city: string;
  cityImputed: boolean;
  synthetic: boolean;
  priceFromKzt: number;
  priceImputed: boolean;
  eventFormats: string[];
  languages: string[];
  /** null — работа не привязана к присутствию на площадке (флорист, декоратор, сувениры) */
  maxHours: number | null;
  busyDates: string[];
  description: string;
};

export type MatchRequest = {
  city: string;
  /** 'YYYY-MM-DD' */
  date: string;
  category: string;
  eventFormat?: string;
  budgetKzt?: number;
  durationHours?: number;
  language?: string;
  /** мягкие пожелания из чата: «украсит розами», «без пошлых конкурсов» */
  wishes?: string[];
};

export type Outcome =
  | 'MATCHED'
  | 'NO_CATEGORY_IN_CITY'
  | 'NO_FORMAT_IN_POOL'
  | 'NO_ONE_PASSES';

export type FunnelStep = {
  step: string;
  before: number;
  after: number;
  dropped: number;
  reason: string;
};

export type NearMiss = {
  id: string;
  name: string;
  droppedAt: string;
  reason: string;
};

export type WishCheck = {
  wish: string;
  confirmed: boolean;
  /** фрагмент описания, подтверждающий пожелание */
  evidence?: string;
};

export type ScoreParts = {
  wishes: number;
  formatFocus: number;
  priceFit: number;
  experience: number;
  language: number;
  duration: number;
  semantic: number;
};

export type Facts = {
  priceRank: number;
  priceDeltaToCheapest: number;
  budgetLeftover?: number;
  hoursSpare?: number;
  formatsCount: number;
  languages: string[];
  busyDaysAhead: number;
  nextFreeDate?: string;
  experienceClaims: string[];
  wishChecks: WishCheck[];
  alsoListedAs: string[];
  priceImputed: boolean;
  synthetic: boolean;
};

/** Ось, по которой карточка уникальна внутри выдачи */
export type Differentiator = {
  axis: string;
  value: string;
  tier: 1 | 2 | 3;
};

export type Card = {
  id: string;
  name: string;
  category: string;
  city: string;
  priceFromKzt: number;
  score: number;
  parts: ScoreParts;
  facts: Facts;
  differentiators: Differentiator[];
  explanation?: string;
  /** для карточек из блока послаблений */
  relaxation?: {
    rule: 'NEAREST' | 'SOFT_DATE' | 'NEIGHBOUR_FORMAT' | 'FLY_IN' | 'BUDGET_STRETCH' | 'DURATION_STRETCH';
    label: string;
    detail: string;
    /** стоимость проезда, если карточка из другого города */
    travel?: TravelCost;
  };
};

export type MatchResponse = {
  outcome: Outcome;
  message: string;
  cards: Card[];
  softCards: Card[];
  /** ближайшие по параметрам — показываются, когда не прошёл никто */
  nearestCards: Card[];
  funnel: FunnelStep[];
  nearMisses: NearMiss[];
  request: MatchRequest;
  notes: string[];
  timings: { totalMs: number };
};
