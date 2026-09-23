import { NextResponse } from 'next/server';
import { match } from '@/lib/match';
import { explain, templateExplanation } from '@/lib/explain';
import { META } from '@/lib/catalog';
import type { MatchRequest } from '@/lib/types';

// fs и данные из репозитория — только node-рантайм, не edge
export const runtime = 'nodejs';

function validate(body: Partial<MatchRequest>): string | null {
  if (!body.city || !META.cities.includes(body.city)) return `Город должен быть одним из: ${META.cities.join(', ')}`;
  if (!body.category || !META.categories.includes(body.category)) return 'Неизвестная категория';
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return 'Дата в формате YYYY-MM-DD обязательна';
  if (body.date < META.dateWindow.from || body.date > META.dateWindow.to) {
    return `Дата вне окна каталога (${META.dateWindow.from} — ${META.dateWindow.to})`;
  }
  if (body.eventFormat && !META.eventFormats.includes(body.eventFormat)) return 'Неизвестный формат мероприятия';
  if (body.language && !META.languages.includes(body.language)) return 'Неизвестный язык';
  return null;
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<MatchRequest>;
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const { llm, ...rest } = body as MatchRequest & { llm?: boolean };
  const req = rest as MatchRequest;
  const result = match(req);
  const all = [...result.cards, ...result.softCards, ...result.nearestCards];
  const { texts, source, issues } = llm === false
    ? { texts: Object.fromEntries(all.map((c) => [c.id, templateExplanation(c, req)])), source: 'template' as const, issues: [] }
    : await explain(all, req);
  return NextResponse.json({
    ...result,
    cards: result.cards.map((c) => ({ ...c, explanation: texts[c.id] })),
    softCards: result.softCards.map((c) => ({ ...c, explanation: texts[c.id] })),
    nearestCards: result.nearestCards.map((c) => ({ ...c, explanation: texts[c.id] })),
    explanationSource: source,
    explanationIssues: issues,
  });
}
