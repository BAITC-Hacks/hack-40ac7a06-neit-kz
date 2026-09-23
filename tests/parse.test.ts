import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { matchCategory, matchCity, matchFormat } from '../lib/parse';

test('город распознаётся в любом падеже и регистре', () => {
  for (const raw of ['Астана', 'АСтану', 'в астане', 'Астаны', 'нур-султан']) {
    assert.equal(matchCity(raw), 'Астана', `не распознан город: ${raw}`);
  }
  for (const raw of ['Алматы', 'в Алмате', 'алматинский', 'Алмата']) {
    assert.equal(matchCity(raw), 'Алматы', `не распознан город: ${raw}`);
  }
});

test('города вне каталога не подменяются ближайшим', () => {
  for (const raw of ['Шымкент', 'Караганда', 'Актау']) {
    assert.equal(matchCity(raw), undefined, `${raw} не должен сопоставляться ни с чем`);
  }
});

test('категория распознаётся в падежах и по синонимам', () => {
  assert.equal(matchCategory('ведущего'), 'Ведущий');
  assert.equal(matchCategory('тамаду'), 'Ведущий');
  assert.equal(matchCategory('фотографа'), 'Фотограф');
  assert.equal(matchCategory('банкетный зал'), 'Банкетный зал');
  assert.equal(matchCategory('флориста'), 'Флорист');
  assert.equal(matchCategory('кавер-группу'), 'Лайв-бэнд');
});

test('формат мероприятия распознаётся в падежах', () => {
  assert.equal(matchFormat('на свадьбу'), 'свадьба');
  assert.equal(matchFormat('свадьбы'), 'свадьба');
  assert.equal(matchFormat('на той'), 'той');
  assert.equal(matchFormat('корпоратива'), 'корпоратив');
  assert.equal(matchFormat('конференцию'), 'конференция');
  assert.equal(matchFormat('юбилея'), 'юбилей');
});

test('короткие синонимы срабатывают только точным совпадением', () => {
  // «др» — день рождения, но «другой» им быть не должен
  assert.equal(matchFormat('др'), 'день рождения');
  assert.equal(matchFormat('другое мероприятие'), undefined);
});
