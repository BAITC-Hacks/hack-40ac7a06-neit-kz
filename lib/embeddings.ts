import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';

/**
 * Семантика для пожеланий: «украсит розами», «без пошлых конкурсов».
 * Это открытое множество — со списком категорий его не сверишь, поэтому здесь
 * эмбеддинги, а не словарь.
 *
 * Оба слоя лежат в репозитории, чтобы проверка работала без ключа:
 *   data/embeddings.json       — векторы предложений из 66 описаний;
 *   data/wish-embeddings.json  — векторы пожеланий, уже встречавшихся (демо-сценарии).
 * Пожелание не из кэша при отсутствующем ключе семантику не получает —
 * тогда работает словарное сравнение, и об этом честно говорится в карточке.
 */

export const EMBEDDING_MODEL = 'text-embedding-3-small';
/** 256 вместо 1536: файл в шесть раз меньше, качество на коротких текстах практически то же. */
export const EMBEDDING_DIMENSIONS = 256;

/** Порог подтверждения пожелания. Выбран по замеру на реальных описаниях, см. README. */
export const WISH_MATCH_THRESHOLD = 0.42;

const WISH_CACHE_PATH = join(process.cwd(), 'data', 'wish-embeddings.json');

type SentenceVector = { id: string; text: string; vec: number[] };
type EmbeddingsFile = {
  model: string;
  dimensions: number;
  builtAt: string;
  sentences: SentenceVector[];
};

let corpus: EmbeddingsFile | null | undefined;
let wishCache: Record<string, number[]> | null = null;

/** Предложения описания — единица сравнения и одновременно цитата-улика. */
export function sentencesOf(description: string): string[] {
  return description
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15)
    .slice(0, 8);
}

function loadCorpus(): EmbeddingsFile | null {
  if (corpus !== undefined) return corpus;
  try {
    corpus = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'embeddings.json'), 'utf8'),
    ) as EmbeddingsFile;
  } catch {
    corpus = null;
  }
  return corpus;
}

function loadWishCache(): Record<string, number[]> {
  if (wishCache) return wishCache;
  try {
    wishCache = JSON.parse(readFileSync(WISH_CACHE_PATH, 'utf8')) as Record<string, number[]>;
  } catch {
    wishCache = {};
  }
  return wishCache;
}

function saveWishCache(): void {
  // Сливаем с диском: иначе долгоживущий процесс затрёт чужие записи (уже наступали).
  try {
    let onDisk: Record<string, number[]> = {};
    try {
      onDisk = JSON.parse(readFileSync(WISH_CACHE_PATH, 'utf8')) as Record<string, number[]>;
    } catch {
      onDisk = {};
    }
    const merged = { ...onDisk, ...(wishCache ?? {}) };
    wishCache = merged;
    writeFileSync(WISH_CACHE_PATH, `${JSON.stringify(merged)}\n`, 'utf8');
  } catch {
    /* на Vercel файловая система только для чтения */
  }
}

export function wishKey(wish: string): string {
  const norm = wish.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMENSIONS}:${norm}`).digest('hex').slice(0, 16);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Вектор пожелания: сначала кэш репозитория, потом — вызов модели, если есть ключ. */
export async function embedWish(wish: string): Promise<number[] | undefined> {
  const key = wishKey(wish);
  const cache = loadWishCache();
  if (cache[key]) return cache[key];

  if (!process.env.OPENAI_API_KEY || process.env.LLM_ENABLED === 'false') return undefined;
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input: wish,
    });
    const vec = res.data[0].embedding.map((v) => Math.round(v * 10_000) / 10_000);
    cache[key] = vec;
    saveWishCache();
    return vec;
  } catch {
    return undefined;
  }
}

/** Ближайшее предложение профиля к пожеланию: с чем сравнивали и насколько похоже. */
export function bestSentence(
  contractorId: string,
  wishVector: number[],
): { text: string; score: number } | undefined {
  const file = loadCorpus();
  if (!file) return undefined;
  let best: { text: string; score: number } | undefined;
  for (const s of file.sentences) {
    if (s.id !== contractorId) continue;
    const score = cosine(wishVector, s.vec);
    if (!best || score > best.score) best = { text: s.text, score };
  }
  return best;
}

export function corpusInfo(): { ready: boolean; builtAt?: string; sentences?: number } {
  const file = loadCorpus();
  return file ? { ready: true, builtAt: file.builtAt, sentences: file.sentences.length } : { ready: false };
}
