/**
 * Показ дат человеку. Ядро работает со строками 'YYYY-MM-DD' и таким их и отдаёт:
 * на них завязаны сравнения, эталоны в samples/golden и кэш объяснений. Поэтому формат —
 * дело слоя отрисовки, а не домена: здесь ISO-дата превращается в «15 декабря» перед выводом.
 */

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * 'YYYY-MM-DD' → «15 декабря». Год опускаем: весь каталог лежит внутри одного года,
 * и в фразе «занят 15 декабря, свободен 16 декабря» он только мешает читать.
 * Непохожая на дату строка возвращается как есть — экран не должен ломаться на мусоре.
 */
export function formatRuDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  return `${day} ${MONTHS[month - 1]}`;
}

/** Заменяет все ISO-даты внутри готового текста: сообщений исхода, оговорок, объяснений. */
export function humanizeDates(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, formatRuDate);
}

/** То же для необязательного текста — чтобы не городить проверки на каждом месте вывода. */
export function humanizeMaybe(text?: string): string | undefined {
  return text === undefined ? undefined : humanizeDates(text);
}
