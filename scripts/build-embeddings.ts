/**
 * Считает эмбеддинги предложений из описаний профилей и кладёт их в репозиторий.
 *
 *   npm run build:embeddings   — нужен OPENAI_API_KEY, запускается нами один раз
 *
 * Результат коммитится: `npm run verify` и `npm run dev` у проверяющего работают
 * без ключа и получают ровно те же числа, что и мы.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import OpenAI from 'openai';
import { CONTRACTORS } from '../lib/catalog';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, sentencesOf } from '../lib/embeddings';

const OUT = join(process.cwd(), 'data', 'embeddings.json');

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Нужен OPENAI_API_KEY. Файл не тронут.');
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const items: Array<{ id: string; text: string }> = [];
  for (const c of CONTRACTORS) {
    for (const s of sentencesOf(c.description)) {
      items.push({ id: c.id, text: s });
    }
  }
  console.log(`предложений: ${items.length} из ${CONTRACTORS.length} профилей`);

  const vectors: number[][] = [];
  const BATCH = 96;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const res = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      input: chunk.map((x) => x.text),
    });
    for (const d of res.data) vectors.push(d.embedding.map((v) => Math.round(v * 10_000) / 10_000));
    console.log(`  посчитано ${Math.min(i + BATCH, items.length)} / ${items.length}`);
  }

  const payload = {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    builtAt: new Date().toISOString().slice(0, 10),
    sentences: items.map((x, i) => ({ id: x.id, text: x.text, vec: vectors[i] })),
  };
  writeFileSync(OUT, `${JSON.stringify(payload)}\n`, 'utf8');
  console.log(`записано: data/embeddings.json (${(JSON.stringify(payload).length / 1024).toFixed(0)} КБ)`);
}

void main();
