'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Card, MatchRequest, MatchResponse } from '@/lib/types';

/**
 * Встраиваемый виджет: чат-бот, который ведёт предварительный диалог и показывает подбор.
 *
 * Отдельная страница без шапки — её вставляют на сайт площадки через <iframe>.
 * Разбор идёт в два прогона (/api/brief): сначала сколько позиций нужно клиенту,
 * потом условия каждой. Поэтому «ведущий и фотограф на свадьбу» даёт две подборки,
 * а не одну, и у каждой свой бюджет.
 */

type Known = {
  city?: string; date?: string; category?: string; eventFormat?: string;
  budgetKzt?: number; durationHours?: number; language?: string; wishes?: string[];
};

type Position = {
  category: string; city?: string; date?: string; eventFormat?: string;
  budgetKzt?: number; durationHours?: number; language?: string;
  wishes: string[]; missing: string[]; summary: string;
};

type Brief = {
  positions: Position[];
  unsupported: Array<{ quote: string; reason: string }>;
  notes?: string[];
  question?: string;
  summary: string;
};

type Message = { role: 'bot' | 'user'; text: string };
type Result = { position: Position; data: MatchResponse };

const money = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

const OUTCOME_LABEL: Record<string, string> = {
  MATCHED: 'Подобрали',
  NO_CATEGORY_IN_CITY: 'В этом городе таких нет',
  NO_FORMAT_IN_POOL: 'Этот формат не берут',
  NO_ONE_PASSES: 'Под ваши условия никто не подходит',
};

function WidgetInner() {
  const params = useSearchParams();
  const [known, setKnown] = useState<Known>({});
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'bot',
      text: 'Расскажите, что за мероприятие и кто нужен. Можно сразу несколько: «ведущий и фотограф на свадьбу в Алматы 18 ноября, ведущему 900 тысяч, фотографу 300».',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const bottom = useRef<HTMLDivElement>(null);
  const presetApplied = useRef(false);

  useEffect(() => {
    if (presetApplied.current) return;
    const preset: Known = {};
    const city = params.get('city');
    const category = params.get('category');
    const date = params.get('date');
    const budget = params.get('budget');
    const format = params.get('format');
    if (city) preset.city = city;
    if (category) preset.category = category;
    if (date) preset.date = date;
    if (format) preset.eventFormat = format;
    if (budget && Number(budget) > 0) preset.budgetKzt = Number(budget);
    if (Object.keys(preset).length === 0) return;

    presetApplied.current = true;
    setKnown(preset);

    // Площадка передала всё нужное — показываем подбор сразу, без лишних вопросов.
    if (preset.city && preset.category && preset.date) {
      const what = [preset.category, preset.city, preset.eventFormat, preset.date].filter(Boolean).join(' · ');
      setMessages((m) => [...m, { role: 'bot', text: `Вижу запрос из каталога: ${what}. Показываю, кто подходит.` }]);
      void runSearch([
        {
          category: preset.category, city: preset.city, date: preset.date,
          eventFormat: preset.eventFormat, budgetKzt: preset.budgetKzt,
          wishes: [], missing: [], summary: what,
        },
      ]);
      return;
    }

    setMessages((m) => [
      ...m,
      { role: 'bot', text: `Вижу из каталога: ${[preset.category, preset.city].filter(Boolean).join(' · ')}. Осталось уточнить дату и бюджет.` },
    ]);
  }, [params]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, results]);

  /** Просьбы «ещё вариантов» отвечаем кодом: это не новое поле, а запрос на расширение. */
  function isMoreRequest(text: string): boolean {
    return /ещ[её]|друг|вариант|альтернатив|больше/i.test(text) && text.length < 40;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);

    if (isMoreRequest(text) && results.length > 0) {
      const hint = results[0].data.message.match(/Если дата гибкая: ([\d-]+) подходящих (\d+)/);
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: hint
            ? `Под ваши условия это всё, кто есть. Но ${hint[1]} свободных ${hint[2]} — скажите «ищи на ${hint[1]}», и покажу их. Ещё можно поднять бюджет или убрать формат.`
            : 'Под ваши условия это всё, кто есть. Назовите другую дату или бюджет — пересчитаю.',
        },
      ]);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, known }),
      });
      const brief = (await res.json()) as Brief;
      if (!res.ok) throw new Error('не разобрал');

      // Общие поля запоминаем для следующих реплик. Когда позиций несколько,
      // категорию и бюджет в память не кладём: они у каждой позиции свои.
      const first = brief.positions[0];
      const single = brief.positions.length === 1;
      setKnown({
        city: first?.city ?? known.city,
        date: first?.date ?? known.date,
        eventFormat: first?.eventFormat ?? known.eventFormat,
        language: first?.language ?? known.language,
        category: single ? first?.category : undefined,
        budgetKzt: single ? first?.budgetKzt : undefined,
        wishes: single ? first?.wishes : undefined,
      });

      const notes = [
        ...brief.unsupported.map((u) => `«${u.quote}» — ${u.reason}`),
        ...(brief.notes ?? []),
      ];
      const heard =
        brief.positions.length > 1
          ? `Понял ${brief.positions.length} позиции:\n${brief.positions.map((p) => `• ${p.summary}`).join('\n')}`
          : brief.summary
            ? `Понял так: ${brief.summary.replace(/\n/g, '. ')}`
            : '';

      setMessages((m) => [
        ...m,
        ...(notes.length ? [{ role: 'bot' as const, text: notes.join('\n') }] : []),
        { role: 'bot', text: [heard, brief.question].filter(Boolean).join('\n') },
      ]);

      const ready = brief.positions.filter((p) => p.city && p.date);
      if (ready.length) await runSearch(ready);
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Не получилось разобрать. Напишите иначе, пожалуйста.' }]);
    } finally {
      setBusy(false);
    }
  }

  /** Подбор по каждой позиции отдельно: у них разные категории, бюджеты и пожелания. */
  async function runSearch(positions: Position[]) {
    const found: Result[] = [];
    for (const p of positions) {
      if (!p.city || !p.date) continue;
      const body: MatchRequest = {
        city: p.city, category: p.category, date: p.date,
        eventFormat: p.eventFormat, budgetKzt: p.budgetKzt,
        durationHours: p.durationHours, language: p.language,
        wishes: p.wishes?.length ? p.wishes : undefined,
      };
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;
      found.push({ position: p, data: (await res.json()) as MatchResponse });
    }
    setResults(found);

    if (found.some((r) => r.data.cards.length + r.data.softCards.length + r.data.nearestCards.length < 3)) {
      setMessages((m) => [
        ...m,
        { role: 'bot', text: 'Могу расширить поиск: назовите другую дату, поднимите бюджет или снимите формат.' },
      ]);
    }

    // Площадка может показать подборку своими средствами — по каждой позиции отдельно.
    try {
      window.parent?.postMessage(
        {
          type: 'podbor:match',
          positions: found.map((r) => ({
            category: r.position.category,
            request: r.data.request,
            outcome: r.data.outcome,
            message: r.data.message,
            cards: [...r.data.cards, ...r.data.softCards, ...r.data.nearestCards].map((c) => ({
              id: c.id, name: c.name, category: c.category, city: c.city,
              priceFromKzt: c.priceFromKzt, explanation: c.explanation, relaxation: c.relaxation?.label,
            })),
          })),
        },
        '*',
      );
    } catch {
      /* виджет может быть открыт и без родителя */
    }
  }

  function restart() {
    setKnown({});
    setResults([]);
    setMessages([{ role: 'bot', text: 'Начнём заново. Кто нужен и на какое мероприятие?' }]);
  }

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2.5">
        <span className="text-sm font-semibold">Подбор подрядчиков</span>
        <button onClick={restart} className="text-xs text-slate-500 underline">начать заново</button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <span
              className={`inline-block max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${
                m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}

        {results.map((r) => (
          <section key={r.position.category} className="pt-2">
            <div className="mb-1 flex items-baseline gap-2">
              <b className="text-sm">{r.position.category}</b>
              <span className="text-[11px] text-slate-500">
                {[
                  r.position.eventFormat,
                  r.position.date,
                  r.position.budgetKzt ? `до ${money(r.position.budgetKzt)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <b>{OUTCOME_LABEL[r.data.outcome] ?? r.data.outcome}.</b> {r.data.message}
            </div>
            <div className="space-y-2">
              {[...r.data.cards, ...r.data.softCards, ...r.data.nearestCards].map((c) => (
                <EmbedCard key={c.id} card={c} />
              ))}
            </div>
          </section>
        ))}
        <div ref={bottom} />
      </div>

      <div className="flex gap-2 border-t border-slate-200 p-3">
        <input
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={input}
          placeholder={busy ? 'Думаю…' : 'Напишите сообщение'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
          disabled={busy}
        />
        <button
          onClick={() => void send()}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Отправить
        </button>
      </div>
    </div>
  );
}

function EmbedCard({ card }: { card: Card }) {
  return (
    <article className={`rounded-xl border p-3 ${card.relaxation ? 'border-dashed border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm">{card.name}</b>
        <span className="text-sm">{money(card.priceFromKzt)}</span>
      </div>
      <div className="text-xs text-slate-500">{card.category} · {card.city}</div>
      {card.relaxation && (
        <div className="mt-1 text-xs text-amber-900">
          <b>{card.relaxation.label}.</b> {card.relaxation.detail}
        </div>
      )}
      {card.relaxation?.travel && (
        <div className="mt-1 text-xs text-sky-800">
          ✈️ проезд от {money(card.relaxation.travel.totalKzt)} на {card.relaxation.travel.headcount} чел.
        </div>
      )}
      {card.explanation && <p className="mt-1 text-xs leading-relaxed">{card.explanation}</p>}
    </article>
  );
}

export default function EmbedPage() {
  return (
    <Suspense fallback={null}>
      <WidgetInner />
    </Suspense>
  );
}
