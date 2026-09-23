import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CONTRACTORS } from '../lib/catalog';
import { WISH_MATCH_THRESHOLD, bestSentence, corpusInfo } from '../lib/embeddings';
import { checkWishes } from '../lib/scoring';
import { resolveWishVectors } from '../lib/wish-vectors';

const florists = CONTRACTORS.filter((c) => c.categories.includes('Флорист'));

test('корпус эмбеддингов лежит в репозитории и доступен без ключа', () => {
  const info = corpusInfo();
  assert.equal(info.ready, true, 'data/embeddings.json не найден');
  assert.ok((info.sentences ?? 0) > 200, `предложений мало: ${info.sentences}`);
});

test('пожелание из кэша получает вектор без обращения к модели', async () => {
  delete process.env.OPENAI_API_KEY;
  const vectors = await resolveWishVectors(['украсит розами']);
  assert.ok(vectors['украсит розами'], 'вектор пожелания не найден в кэше репозитория');
});

test('чего нет в профилях, то не подтверждается — даже по смыслу', async () => {
  const vectors = await resolveWishVectors(['украсит розами']);
  for (const f of florists) {
    const [check] = checkWishes(f, ['украсит розами'], vectors);
    assert.equal(check.confirmed, false, `${f.name}: розы подтвердились, хотя их нет ни в одном описании`);
    assert.equal(check.source, 'semantic');
    assert.ok((check.score ?? 0) < WISH_MATCH_THRESHOLD);
  }
});

test('близкое по смыслу пожелание подтверждается и приносит цитату', async () => {
  const wish = 'цветочное оформление свадьбы';
  const vectors = await resolveWishVectors([wish]);
  const checks = florists.map((f) => checkWishes(f, [wish], vectors)[0]);
  const confirmed = checks.filter((c) => c.confirmed);
  assert.ok(confirmed.length > 0, 'ни один флорист не подтвердил профильное пожелание');
  for (const c of confirmed) {
    assert.ok(c.evidence && c.evidence.length > 10, 'подтверждение без цитаты из описания');
  }
});

test('без вектора работает словарная подстраховка и это видно в источнике', () => {
  const [check] = checkWishes(florists[0], ['композиции под цветовую палитру'], undefined);
  assert.equal(check.source, 'lexical');
});

test('ближайшее предложение ищется только внутри своего профиля', async () => {
  const vectors = await resolveWishVectors(['украсит розами']);
  const vec = vectors['украсит розами'];
  const best = bestSentence(florists[0].id, vec)!;
  assert.ok(florists[0].description.includes(best.text.slice(0, 20)), 'улика взята из чужого профиля');
});
