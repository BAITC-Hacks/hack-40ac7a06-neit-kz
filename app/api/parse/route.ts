import { NextResponse } from 'next/server';
import { parseRequest } from '@/lib/parse';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { text } = (await request.json()) as { text?: string };
  if (!text || text.trim().length < 3) {
    return NextResponse.json({ error: 'Напишите запрос словами' }, { status: 400 });
  }
  return NextResponse.json(await parseRequest(text.slice(0, 1000)));
}
