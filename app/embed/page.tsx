'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Card, MatchRequest, MatchResponse } from '@/lib/types';

/**
 * Встраиваемый виджет: чат-бот, который ведёт предварительный диалог и показывает подбор.
 *
 * Отдельная страница без шапки и лишней обвязки — её вставляют на сайт площадки
 * через <iframe>. Тот же движок, те же API: /api/parse для диалога, /api/match для подбора.
 * Параметры запроса (?city=…&category=…) позволяют предзаполнить контекст, если площадка
 * уже знает, что ищет клиент.
 */

type Known = {
  city?: string; date?: string; category?: string; eventFormat?: string;
  budgetKzt?: number; durationHours?: number; language?: string; wishes?: string[];
};

type Parsed = Known & {
  wishes: string[];
  missing: string[];
  unsupported: Array<{ quote: string; reason: string }>;
  question?: string;
  summary: string;
};

type Message = { role: 'bot' | 'user'; text: string };

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
    { role: 'bot', text: 'Расскажите, что за мероприятие и кто нужен. Например: «ведущий на свадьбу в Алматы 18 ноября, бюджет до миллиона».' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const presetApplied = useRef(false);

  // Площадка может передать то, что уже знает о клиенте.
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
      const what = [preset.category, preset.city, preset.eventFormat, preset.date]
        .filter(Boolean)
        .join(' · ');
      setMessages((m) => [...m, { role: 'bot', text: `Вижу запрос из каталога: ${what}. Показываю, кто подходит.` }]);
      void search(preset);
      return;
    }

    setMessages((m) => [
      ...m,
      { role: 'bot', text: `Вижу из каталога: ${[preset.category, preset.city].filter(Boolean).join(' · ')}. Осталось уточнить дату и бюджет.` },
    ]);
  }, [params]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, result]);

  /** Просьбы «ещё вариантов» отвечаем кодом: это не новое поле, а запрос на расширение. */
  function isMoreRequest(text: string): boolean {
    return /ещ[её]|друг|вариант|альтернатив|больше/i.test(text) && text.length < 40;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);

    if (isMoreRequest(text) && result) {
      const hint = result.message.match(/Если дата гибкая: ([\d-]+) подходящих (\d+)/);
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
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, known }),
      });
      const parsed = (await res.json()) as Parsed;
      if (!res.ok) throw new Error('не разобрал');

      const next: Known = {
        city: parsed.city, date: parsed.date, category: parsed.category,
        eventFormat: parsed.eventFormat, budgetKzt: parsed.budgetKzt,
        durationHours: parsed.durationHours, language: parsed.language, wishes: parsed.wishes,
      };
      setKnown(next);

      const notes = parsed.unsupported.map((u) => `«${u.quote}» — ${u.reason}`);
      const said = parsed.summary ? `Понял так: ${parsed.summary.replace(/\n/g, '. ')}` : '';
      setMessages((m) => [
        ...m,
        ...(notes.length ? [{ role: 'bot' as const, text: notes.join('\n') }] : []),
        { role: 'bot', text: [said, parsed.question].filter(Boolean).join('\n') },
      ]);

      if (parsed.missing.length === 0 && next.city && next.category && next.date) {
        await search(next);
      }
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Не получилось разобрать. Напишите иначе, пожалуйста.' }]);
    } finally {
      setBusy(false);
    }
  }

  async function search(k: Known) {
    const body: MatchRequest = {
      city: k.city!, category: k.category!, date: k.date!,
      eventFormat: k.eventFormat, budgetKzt: k.budgetKzt,
      durationHours: k.durationHours, language: k.language,
      wishes: k.wishes?.length ? k.wishes : undefined,
    };
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as MatchResponse;
    if (!res.ok) return;
    setResult(json);

    // Площадка может показать подборку своими средствами — например, подсветить
    // подходящих в собственном каталоге. Виджет отдаёт результат наружу.
    try {
      window.parent?.postMessage(
        {
          type: 'podbor:match',
          outcome: json.outcome,
          message: json.message,
          request: json.request,
          cards: [...json.cards, ...json.softCards, ...json.nearestCards].map((c) => ({
            id: c.id,
            name: c.name,
            category: c.category,
            city: c.city,
            priceFromKzt: c.priceFromKzt,
            explanation: c.explanation,
            relaxation: c.relaxation?.label,
          })),
        },
        '*',
      );
    } catch {
      /* виджет может быть открыт и без родителя */
    }

    // Меньше трёх — сразу говорим, чем можно расширить поиск.
    if (json.cards.length + json.softCards.length + json.nearestCards.length < 3) {
      setMessages((m) => [
        ...m,
        {
          role: 'bot',
          text: 'Могу расширить поиск: назовите другую дату, поднимите бюджет или снимите формат — скажите словами, что менять.',
        },
      ]);
    }
  }

  function restart() {
    setKnown({});
    setResult(null);
    setMessages([{ role: 'bot', text: 'Начнём заново. Кто нужен и на какое мероприятие?' }]);
  }

  const all = result ? [...result.cards, ...result.softCards, ...result.nearestCards] : [];

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2.5">
        <span className="text-sm font-semibold">Подбор подрядчика</span>
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

        {result && (
          <div className="pt-2">
            <div className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <b>{OUTCOME_LABEL[result.outcome] ?? result.outcome}.</b> {result.message}
            </div>
            <div className="space-y-2">
              {all.map((c) => <EmbedCard key={c.id} card={c} />)}
            </div>
          </div>
        )}
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
