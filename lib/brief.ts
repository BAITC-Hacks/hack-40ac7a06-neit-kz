import OpenAI from 'openai';
import { META, medianPrice } from './catalog';
import {
  MODEL,
  budgetGrounded,
  countPrompt,
  matchCategory,
  matchCity,
  matchFormat,
  parseRequest,
  positionPrompt,
  type KnownFields,
} from './parse';

/**
 * Разбор в два прогона: сколько позиций → детали каждой.
 *
 * Паттерн из парсера CastHub (countRoles → extractRole по каждой роли).
 * Один промпт на всё путает поля между позициями: «ведущему 500, фотографу 300»
 * превращается в одну сумму. Отдельный прогон на позицию видит только свою
 * категорию и отвечает за одну задачу.
 */

export type Position = {
  category: string;
  city?: string;
  date?: string;
  eventFormat?: string;
  budgetKzt?: number;
  durationHours?: number;
  language?: string;
  wishes: string[];
  missing: string[];
  summary: string;
};

export type Brief = {
  positions: Position[];
  unsupported: Array<{ quote: string; reason: string }>;
  /** честные оговорки о разборе: например, что бюджет назван общий */
  notes: string[];
  question?: string;
  summary: string;
};

type RawPosition = {
  city?: string;
  date?: string;
  eventFormat?: string;
  budgetKzt?: number;
  durationHours?: number;
  language?: string;
  wishes?: string[];
  unclear?: Array<{ quote?: string; note?: string }>;
};

async function askJson(system: string, user: string): Promise<Record<string, unknown>> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return JSON.parse(res.choices[0]?.message?.content ?? '{}') as Record<string, unknown>;
}

/** Прогон 1: какие категории просит клиент. Валидация — строго по перечню каталога. */
async function countPositions(
  text: string,
): Promise<{ categories: string[]; unsupported: Brief['unsupported'] }> {
  const raw = await askJson(countPrompt(), text);
  const unsupported: Brief['unsupported'] = [];

  const list = Array.isArray(raw.categories) ? (raw.categories as unknown[]) : [];
  const categories: string[] = [];
  for (const item of list) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    const resolved = META.categories.includes(value) ? value : matchCategory(value);
    if (!resolved) {
      unsupported.push({ quote: value, reason: 'такой категории в каталоге нет' });
      continue;
    }
    if (!categories.includes(resolved)) categories.push(resolved);
  }

  for (const u of (raw.unclear as Array<{ quote?: string; note?: string }> | undefined) ?? []) {
    if (u?.quote) unsupported.push({ quote: u.quote, reason: u.note ?? 'не удалось разобрать' });
  }
  return { categories, unsupported };
}

function summarize(p: Position): string {
  return [
    p.category,
    p.city,
    p.eventFormat,
    p.date,
    p.budgetKzt ? `до ${p.budgetKzt.toLocaleString('ru-RU')} ₸` : undefined,
    p.language,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Прогон 2: условия одной позиции. Промпт видит только её категорию. */
async function extractPosition(text: string, category: string, known?: KnownFields): Promise<Position> {
  const raw = (await askJson(positionPrompt(category), text)) as RawPosition;

  const city = raw.city && META.cities.includes(raw.city) ? raw.city : matchCity(raw.city ?? '');
  const eventFormat =
    raw.eventFormat && META.eventFormats.includes(raw.eventFormat)
      ? raw.eventFormat
      : matchFormat(raw.eventFormat ?? '');

  const date =
    raw.date &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.date) &&
    raw.date >= META.dateWindow.from &&
    raw.date <= META.dateWindow.to
      ? raw.date
      : undefined;

  const budgetKzt =
    typeof raw.budgetKzt === 'number' && raw.budgetKzt > 0 && budgetGrounded(text, raw.budgetKzt)
      ? raw.budgetKzt
      : undefined;

  const language = raw.language && META.languages.includes(raw.language) ? raw.language : undefined;
  const durationHours =
    typeof raw.durationHours === 'number' && raw.durationHours > 0 && raw.durationHours <= 24
      ? raw.durationHours
      : undefined;

  const position: Position = {
    category,
    city: city ?? known?.city ?? matchCity(text),
    date: date ?? known?.date,
    eventFormat: eventFormat ?? known?.eventFormat ?? matchFormat(text),
    budgetKzt: budgetKzt ?? known?.budgetKzt,
    durationHours: durationHours ?? known?.durationHours,
    language: language ?? known?.language,
    // Отсеиваем пожелания, которые просто пересказывают категорию или формат:
    // «фотограф нужен для корпоратива» — это не пожелание, это уже поля запроса.
    wishes: (raw.wishes ?? [])
      .map((w) => String(w).trim())
      .filter((w) => w.length > 2)
      .filter((w) => !(matchCategory(w) === category || (matchFormat(w) && matchCategory(w) === category)))
      .filter((w) => !(matchCategory(w) && matchFormat(w)))
      .slice(0, 4),
    missing: [],
    summary: '',
  };
  position.summary = summarize(position);
  return position;
}

/** Одна позиция из обычного разбора — путь без ключа и запасной вариант. */
async function singlePositionBrief(text: string, known?: KnownFields): Promise<Brief> {
  const one = await parseRequest(text, known);
  const positions: Position[] = one.category
    ? [
        {
          category: one.category,
          city: one.city,
          date: one.date,
          eventFormat: one.eventFormat,
          budgetKzt: one.budgetKzt,
          durationHours: one.durationHours,
          language: one.language,
          wishes: one.wishes,
          missing: one.missing.filter((m) => m !== 'категория'),
          summary: one.summary,
        },
      ]
    : [];
  return { positions, unsupported: one.unsupported, notes: [], question: one.question, summary: one.summary };
}

const cache = new Map<string, Brief>();

/**
 * Полный разбор запроса: прогон на подсчёт позиций + по прогону на каждую.
 * Позиции независимы, поэтому разбираются параллельно.
 */
export async function parseBrief(text: string, known?: KnownFields): Promise<Brief> {
  const key = `${JSON.stringify(known ?? {})}|${text.toLowerCase().trim()}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!process.env.OPENAI_API_KEY) return singlePositionBrief(text, known);

  let counted: { categories: string[]; unsupported: Brief['unsupported'] };
  try {
    counted = await countPositions(text);
  } catch {
    return singlePositionBrief(text, known);
  }

  // Категорий не нашлось — падаем на обычный разбор: он умеет искать категорию в тексте.
  if (counted.categories.length === 0) {
    const fallback = await singlePositionBrief(text, known);
    const brief: Brief = {
      ...fallback,
      unsupported: [...counted.unsupported, ...fallback.unsupported],
    };
    cache.set(key, brief);
    return brief;
  }

  const positions = await Promise.all(
    counted.categories.map((c) => extractPosition(text, c, known)),
  );

  // Город, дата и формат обычно общие для мероприятия: если одна позиция их назвала,
  // остальные наследуют — иначе пришлось бы переспрашивать одно и то же по каждой.
  const sharedCity = positions.find((p) => p.city)?.city;
  const sharedDate = positions.find((p) => p.date)?.date;
  const sharedFormat = positions.find((p) => p.eventFormat)?.eventFormat;
  for (const p of positions) {
    p.city = p.city ?? sharedCity;
    p.date = p.date ?? sharedDate;
    p.eventFormat = p.eventFormat ?? sharedFormat;
    p.missing = [...(p.city ? [] : ['город']), ...(p.date ? [] : ['дата'])];
    p.summary = summarize(p);
  }

  // Общий бюджет клиент обычно называет один на всё мероприятие. Делить его поровну
  // бессмысленно: ведущий и фотограф стоят по-разному. Делим пропорционально медианным
  // ценам каталога — это основание из данных, а не наша выдумка, и его видно в карточке.
  const notes: string[] = [];
  const budgets = positions.map((p) => p.budgetKzt).filter((b): b is number => Boolean(b));
  const sharedBudget =
    positions.length > 1 && budgets.length === positions.length && new Set(budgets).size === 1
      ? budgets[0]
      : undefined;

  if (sharedBudget) {
    const medians = positions.map((p) => medianPrice(p.category, p.city) ?? 0);
    const total = medians.reduce((a, b) => a + b, 0);
    if (total > 0) {
      positions.forEach((p, i) => {
        const share = (sharedBudget * medians[i]) / total;
        // Округляем вниз до 10 000 ₸, чтобы сумма долей не вылезла за общий бюджет.
        p.budgetKzt = Math.max(10_000, Math.floor(share / 10_000) * 10_000);
        p.summary = summarize(p);
      });
      notes.push(
        `Бюджет ${sharedBudget.toLocaleString('ru-RU')} ₸ назван общий — разделил его между позициями ` +
          `по медианным ценам каталога: ` +
          positions.map((p) => `${p.category} ${p.budgetKzt!.toLocaleString('ru-RU')} ₸`).join(', ') +
          `. Назовите суммы по позициям, если нужно иначе.`,
      );
    } else {
      notes.push(
        `Бюджет ${sharedBudget.toLocaleString('ru-RU')} ₸ назван общий, но разделить его не на чем: ` +
          `в каталоге нет цен по этим категориям. Применяю как верхнюю границу каждой позиции.`,
      );
    }
  }

  const missing = [...new Set(positions.flatMap((p) => p.missing))];
  const brief: Brief = {
    positions,
    unsupported: counted.unsupported,
    notes,
    question: missing.includes('город')
      ? `В каком городе? В каталоге есть ${META.cities.slice(0, -1).join(', ')} и ${META.cities.at(-1)}.`
      : missing.includes('дата')
        ? `На какую дату? Каталог знает даты с ${META.dateWindow.from} по ${META.dateWindow.to}.`
        : undefined,
    summary: positions.map((p) => p.summary).join('\n'),
  };
  cache.set(key, brief);
  return brief;
}
