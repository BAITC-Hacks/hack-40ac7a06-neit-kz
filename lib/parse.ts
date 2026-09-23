import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { META } from './catalog';

/**
 * L0 — приём свободного запроса.
 *
 * Модель только раскладывает текст на поля. Правило «не выдумывать» держится не просьбой
 * в промпте, а проверками в коде: город и категория берутся строго из словаря каталога,
 * дата обязана попасть в окно датасета, а цифры бюджета — реально присутствовать в тексте
 * пользователя. Всё, что не легло, уходит в `unsupported` с цитатой.
 */

const MODEL = 'gpt-4.1-mini';
const PROMPT_VERSION = 'parse-v1';

export type ParsedRequest = {
  city?: string;
  date?: string;
  category?: string;
  eventFormat?: string;
  budgetKzt?: number;
  durationHours?: number;
  language?: string;
  wishes: string[];
  /** обязательные поля, которых не хватает для поиска */
  missing: string[];
  /** то, чего нет в каталоге: «Шымкент», «фаершоу» */
  unsupported: Array<{ quote: string; reason: string }>;
  /** один уточняющий вопрос, если чего-то не хватает */
  question?: string;
  /** сводка «правильно понял?» */
  summary: string;
};

const CITY_SYNONYMS: Record<string, string> = {
  алматы: 'Алматы', алмата: 'Алматы', алма: 'Алматы', almaty: 'Алматы',
  астана: 'Астана', нурсултан: 'Астана', 'нур-султан': 'Астана', astana: 'Астана',
  зарубежье: 'Зарубежье', заграница: 'Зарубежье',
};

const CATEGORY_SYNONYMS: Record<string, string> = {
  ведущий: 'Ведущий', тамада: 'Ведущий', 'ведущая': 'Ведущий', мс: 'Ведущий',
  'ведущий церемонии': 'Ведущий церемонии', регистратор: 'Ведущий церемонии',
  фотограф: 'Фотограф', фотосъемка: 'Фотограф', фотосъёмка: 'Фотограф',
  видеограф: 'Видеограф', видеосъемка: 'Видеограф', видеосъёмка: 'Видеограф', оператор: 'Видеограф',
  'банкетный зал': 'Банкетный зал', зал: 'Банкетный зал', площадка: 'Банкетный зал',
  ресторан: 'Ресторан', отель: 'Отель', гостиница: 'Отель',
  'загородная площадка': 'Загородная площадка', загородный: 'Загородная площадка',
  флорист: 'Флорист', цветы: 'Флорист', флористика: 'Флорист',
  декоратор: 'Декоратор', декор: 'Декоратор', оформление: 'Декоратор',
  'подарки и сувениры': 'Подарки и сувениры', сувениры: 'Подарки и сувениры', подарки: 'Подарки и сувениры',
  'лайв-бэнд': 'Лайв-бэнд', группа: 'Лайв-бэнд', 'кавер-группа': 'Лайв-бэнд', бэнд: 'Лайв-бэнд',
  инструменталист: 'Инструменталист', музыкант: 'Инструменталист', саксофонист: 'Инструменталист', домбрист: 'Инструменталист',
  'шоу-программа': 'Шоу-программа', шоу: 'Шоу-программа', артисты: 'Шоу-программа',
  'национальный ансамбль': 'Национальный ансамбль', ансамбль: 'Национальный ансамбль',
  'танцевальный коллектив': 'Танцевальный коллектив', танцоры: 'Танцевальный коллектив', танцы: 'Танцевальный коллектив',
  'фото и видеобудки': 'Фото и видеобудки', фотобудка: 'Фото и видеобудки', фотозона: 'Фото и видеобудки',
};

const FORMAT_SYNONYMS: Record<string, string> = {
  свадьба: 'свадьба', свадьбу: 'свадьба', той: 'той', тойы: 'той',
  корпоратив: 'корпоратив', корпоративный: 'корпоратив',
  конференция: 'конференция', форум: 'конференция', конференцию: 'конференция',
  юбилей: 'юбилей', 'день рождения': 'день рождения', днюха: 'день рождения', 'др': 'день рождения',
};

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').trim();
}

/** Длина общего начала двух слов. */
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Сопоставление с каталогом устойчиво к падежам: «АСтану» → Астана,
 * «ведущего» → Ведущий, «юбилея» → юбилей. Сравниваем по общему началу слова,
 * а не по отрезанному окончанию — окончаний в русском слишком много.
 */
function lookup(dict: Record<string, string>, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = norm(raw);
  if (dict[n]) return dict[n];

  const words = n.split(/[^a-zа-я0-9]+/i).filter(Boolean);

  // Сначала точные вхождения. Короткие синонимы («мс», «др») ищем только как
  // отдельное слово: иначе «другое мероприятие» превращается в день рождения.
  for (const [key, value] of Object.entries(dict)) {
    if (key.length <= 2 ? words.includes(key) : n.includes(key)) return value;
  }

  // Потом по общему началу. Порог зависит от длины ключа, чтобы «фотозона»
  // не сопоставилась с «фотограф» по общему «фото».
  for (const [key, value] of Object.entries(dict)) {
    if (key.length <= 4) continue;
    const need = Math.max(5, key.length - 3);
    if (words.some((w) => commonPrefix(w, key) >= need)) return value;
  }
  return undefined;
}

/** Цифры бюджета обязаны присутствовать в тексте пользователя — защита от выдуманной суммы. */
function budgetGrounded(text: string, budget: number): boolean {
  const digits = text.replace(/[^\d]/g, '');
  const raw = String(budget);
  if (digits.includes(raw)) return true;
  // «до миллиона», «1.5 млн», «500 тысяч» — проверяем ведущие цифры
  const lead = raw.replace(/0+$/, '');
  return lead.length > 0 && digits.includes(lead);
}

type RawExtraction = {
  city?: string;
  date?: string;
  category?: string;
  eventFormat?: string;
  budgetKzt?: number;
  durationHours?: number;
  language?: string;
  wishes?: string[];
  unclear?: Array<{ quote: string; note: string }>;
};

function systemPrompt(): string {
  return [
    'Ты разбираешь запрос клиента event-площадки на структурированные поля.',
    `Сегодня 23.09.2026. Каталог работает с датами ${META.dateWindow.from} — ${META.dateWindow.to}.`,
    '',
    'Значения ОБЯЗАНЫ быть выбраны ровно из этих списков, слово в слово:',
    `city: ${META.cities.join(' | ')}`,
    `category: ${META.categories.join(' | ')}`,
    `eventFormat: ${META.eventFormats.join(' | ')}`,
    `language: ${META.languages.join(' | ')}`,
    '',
    'Сопоставляй сам, невзирая на падежи, регистр, опечатки и синонимы:',
    '«в АСтану» → Астана, «тамаду» → Ведущий, «на свадьбу» → свадьба, «кавер-группу» → Лайв-бэнд.',
    'Если подходящего значения в списке НЕТ — поле не пиши, а положи цитату в unclear.',
    'Город, которого нет в списке (Шымкент, Караганда), подменять ближайшим ЗАПРЕЩЕНО.',
    '',
    'Верни JSON:',
    '{"city":"","date":"YYYY-MM-DD","category":"","eventFormat":"","budgetKzt":0,',
    ' "durationHours":0,"language":"","wishes":["короткие формулировки пожеланий"],',
    ' "unclear":[{"quote":"цитата из запроса","note":"что непонятно"}]}',
    '',
    'ПРАВИЛА:',
    '1. Заполняй только то, что человек сказал явно. Ничего не додумывай.',
    '2. Если чего-то нет — НЕ пиши поле вообще. Пустая строка и ноль тоже запрещены.',
    '3. «Недорого», «подешевле» — это НЕ бюджет. Бюджет только если названа сумма.',
    '4. Пожелания — то, что нельзя выразить полями: стиль, темы, особые требования.',
    '5. Всё, в чём не уверен, клади в unclear с точной цитатой.',
  ].join('\n');
}

export const matchCity = (raw: string) => lookup(CITY_SYNONYMS, raw);
export const matchCategory = (raw: string) => lookup(CATEGORY_SYNONYMS, raw);
export const matchFormat = (raw: string) => lookup(FORMAT_SYNONYMS, raw);

const cache = new Map<string, ParsedRequest>();

function cacheKey(text: string): string {
  return createHash('sha256').update(`${PROMPT_VERSION}|${MODEL}|${norm(text)}`).digest('hex').slice(0, 24);
}

/** Сводка для подтверждения пользователем. */
function buildSummary(p: ParsedRequest): string {
  const bits = [
    p.category,
    p.city,
    p.eventFormat,
    p.date,
    p.budgetKzt ? `до ${p.budgetKzt.toLocaleString('ru-RU')} ₸` : undefined,
    p.durationHours ? `${p.durationHours} ч` : undefined,
    p.language,
  ].filter(Boolean);
  const head = bits.length ? bits.join(' · ') : 'пока ничего не понял';
  return p.wishes.length ? `${head}\nПожелания: ${p.wishes.join(' · ')}` : head;
}

function buildQuestion(p: ParsedRequest): string | undefined {
  if (p.missing.includes('категория')) return 'Какой подрядчик нужен — ведущий, фотограф, площадка, кто-то ещё?';
  if (p.missing.includes('город')) return `В каком городе? В каталоге есть ${META.cities.slice(0, -1).join(', ')} и ${META.cities.at(-1)}.`;
  if (p.missing.includes('дата')) return `На какую дату? Каталог знает даты с ${META.dateWindow.from} по ${META.dateWindow.to}.`;
  if (!p.budgetKzt) return 'Какой у вас бюджет? Если не важно — можно искать без него.';
  return undefined;
}

/** Уже известные поля: диалог накапливает картину, а не начинает её заново каждой репликой. */
export type KnownFields = Partial<
  Pick<ParsedRequest, 'city' | 'date' | 'category' | 'eventFormat' | 'budgetKzt' | 'durationHours' | 'language'>
> & { wishes?: string[] };

export async function parseRequest(text: string, known?: KnownFields): Promise<ParsedRequest> {
  const key = cacheKey(`${JSON.stringify(known ?? {})}|${text}`);
  const hit = cache.get(key);
  if (hit) return hit;

  const empty: ParsedRequest = {
    wishes: [],
    missing: ['категория', 'город', 'дата'],
    unsupported: [],
    summary: '',
  };

  if (!process.env.OPENAI_API_KEY) {
    return { ...empty, question: 'Разбор запроса недоступен без ключа модели — заполните форму ниже.' };
  }

  let raw: RawExtraction = {};
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: text },
      ],
    });
    raw = JSON.parse(res.choices[0]?.message?.content ?? '{}') as RawExtraction;
  } catch {
    return { ...empty, question: 'Не удалось разобрать запрос — заполните форму ниже.' };
  }

  const unsupported: ParsedRequest['unsupported'] = [];

  // Город: только из словаря каталога. Чужой город — не подмена ближайшим, а честный отказ.
  // Модель обязана вернуть значение из перечня каталога. Словари остаются
  // подстраховкой: они же работают, когда ключа нет вовсе.
  let city = raw.city && META.cities.includes(raw.city) ? raw.city : lookup(CITY_SYNONYMS, raw.city);
  if (raw.city && !city) {
    unsupported.push({
      quote: raw.city,
      reason: `в каталоге только ${META.cities.join(', ')} — этого города нет`,
    });
  }

  // Категория и формат: модель их регулярно меняет местами («ведущий на свадьбу»),
  // поэтому каждое значение проверяем по обоим словарям и раскладываем по местам сами.
  let category =
    raw.category && META.categories.includes(raw.category)
      ? raw.category
      : lookup(CATEGORY_SYNONYMS, raw.category);
  let eventFormat =
    raw.eventFormat && META.eventFormats.includes(raw.eventFormat)
      ? raw.eventFormat
      : lookup(FORMAT_SYNONYMS, raw.eventFormat);
  if (!category && raw.eventFormat) category = lookup(CATEGORY_SYNONYMS, raw.eventFormat);
  if (!eventFormat && raw.category) eventFormat = lookup(FORMAT_SYNONYMS, raw.category);

  for (const [value, label] of [
    [raw.category, 'категории'],
    [raw.eventFormat, 'формата мероприятия'],
  ] as Array<[string | undefined, string]>) {
    if (!value) continue;
    const matched =
      lookup(CATEGORY_SYNONYMS, value) === category && category !== undefined
        ? true
        : lookup(FORMAT_SYNONYMS, value) === eventFormat && eventFormat !== undefined;
    if (!matched) {
      unsupported.push({ quote: value, reason: `такой ${label} в каталоге нет` });
    }
  }

  // Дата: обязана попадать в окно датасета
  let date: string | undefined;
  if (raw.date && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    if (raw.date >= META.dateWindow.from && raw.date <= META.dateWindow.to) {
      date = raw.date;
    } else {
      unsupported.push({
        quote: raw.date,
        reason: `каталог знает занятость только с ${META.dateWindow.from} по ${META.dateWindow.to}`,
      });
    }
  }

  // Бюджет: цифры обязаны быть в тексте пользователя
  let budgetKzt: number | undefined;
  if (typeof raw.budgetKzt === 'number' && raw.budgetKzt > 0) {
    if (budgetGrounded(text, raw.budgetKzt)) budgetKzt = raw.budgetKzt;
  }

  let language = raw.language && META.languages.includes(raw.language) ? raw.language : undefined;
  let durationHours =
    typeof raw.durationHours === 'number' && raw.durationHours > 0 && raw.durationHours <= 24
      ? raw.durationHours
      : undefined;

  let wishes = (raw.wishes ?? []).map((w) => String(w).trim()).filter((w) => w.length > 2).slice(0, 4);

  // Иногда модель кладёт саму категорию в пожелания («ведущего из Шымкента»).
  // Поднимаем её на место, чтобы не спрашивать у человека то, что он уже сказал.
  if (!category) {
    const promoted = wishes.find((w) => lookup(CATEGORY_SYNONYMS, w));
    if (promoted) {
      category = lookup(CATEGORY_SYNONYMS, promoted);
      wishes = wishes.filter((w) => w !== promoted);
    }
  }

  // Последняя подстраховка: модель могла просто не вернуть поле. Ищем по исходному
  // тексту сами — словари те же, так что выдумать ничего нельзя.
  if (!category) category = lookup(CATEGORY_SYNONYMS, text);
  if (!city) city = lookup(CITY_SYNONYMS, text);
  if (!eventFormat) eventFormat = lookup(FORMAT_SYNONYMS, text);
  // Модель часто помечает «неясным» то, что мы уже разложили по полям
  // («ведущий» при category = Ведущий). Такие замечания только шумят.
  const resolved = new Set(
    [category, city, eventFormat].filter(Boolean).map((v) => norm(String(v))),
  );
  for (const u of raw.unclear ?? []) {
    if (!u?.quote) continue;
    const handled =
      lookup(CATEGORY_SYNONYMS, u.quote) && resolved.has(norm(lookup(CATEGORY_SYNONYMS, u.quote)!)) ||
      lookup(CITY_SYNONYMS, u.quote) && resolved.has(norm(lookup(CITY_SYNONYMS, u.quote)!)) ||
      lookup(FORMAT_SYNONYMS, u.quote) && resolved.has(norm(lookup(FORMAT_SYNONYMS, u.quote)!));
    if (handled) continue;
    unsupported.push({ quote: u.quote, reason: u.note ?? 'не удалось разобрать' });
  }

  // Одна цитата — одна строка: город мог попасть и в проверку каталога, и в «неясное».
  const seen = new Set<string>();
  const deduped = unsupported.filter((u) => {
    const key = norm(u.quote);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unsupported.length = 0;
  unsupported.push(...deduped);

  // Новая реплика уточняет картину, а не заменяет её.
  //
  // Подменить уже известные город, категорию или формат новая реплика может только
  // если человек назвал их прямо: иначе «хочу репортажную съёмку» превращает
  // выбранного фотографа в видеографа, потому что модель додумывает по смыслу.
  if (known) {
    const saidExplicitly = (dict: Record<string, string>, value: string | undefined) =>
      Boolean(value) && lookup(dict, text) === value;

    if (known.category && category !== known.category && !saidExplicitly(CATEGORY_SYNONYMS, category)) {
      category = known.category;
    }
    if (known.city && city !== known.city && !saidExplicitly(CITY_SYNONYMS, city)) {
      city = known.city;
    }
    if (known.eventFormat && eventFormat !== known.eventFormat && !saidExplicitly(FORMAT_SYNONYMS, eventFormat)) {
      eventFormat = known.eventFormat;
    }

    city = city ?? known.city;
    date = date ?? known.date;
    category = category ?? known.category;
    eventFormat = eventFormat ?? known.eventFormat;
    budgetKzt = budgetKzt ?? known.budgetKzt;
    durationHours = durationHours ?? known.durationHours;
    language = language ?? known.language;
    if (known.wishes?.length) {
      wishes = [...new Set([...known.wishes, ...wishes])].slice(0, 4);
    }
  }

  const missing: string[] = [];
  if (!category) missing.push('категория');
  if (!city) missing.push('город');
  if (!date) missing.push('дата');

  const parsed: ParsedRequest = {
    city, date, category, eventFormat, budgetKzt, durationHours, language,
    wishes, missing, unsupported, summary: '',
  };
  parsed.summary = buildSummary(parsed);
  parsed.question = buildQuestion(parsed);

  cache.set(key, parsed);
  return parsed;
}
