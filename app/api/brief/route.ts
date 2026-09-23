import { NextResponse } from 'next/server';
import { parseBrief } from '@/lib/brief';
import type { KnownFields } from '@/lib/parse';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const { text, known } = (await request.json()) as { text?: string; known?: KnownFields };
  if (!text || text.trim().length < 3) {
    return NextResponse.json({ error: 'Напишите запрос словами' }, { status: 400 });
  }
  return NextResponse.json(await parseBrief(text.slice(0, 1000), known));
}
