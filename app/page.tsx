'use client';

import { useEffect, useRef, useState } from 'react';
import scenarios from '@/data/scenarios.json';
import meta from '@/data/meta.json';
import type { Card, MatchRequest, MatchResponse } from '@/lib/types';

type Scenario = { id: string; title: string; req: MatchRequest };
type ParsedRequest = {
  city?: string; date?: string; category?: string; eventFormat?: string;
  budgetKzt?: number; durationHours?: number; language?: string;
  wishes: string[]; missing: string[];
  unsupported: Array<{ quote: string; reason: string }>;
  question?: string; summary: string;
};
type ApiResponse = MatchResponse & { explanationSource?: string };

const SCENARIOS = scenarios as Scenario[];
const META = meta as {
  categories: string[];
  cities: string[];
  eventFormats: string[];
  languages: string[];
  priceRanges: Record<string, { n: number; min: number; max: number }>;
};

const money = (n: number) => `${n.toLocaleString('ru-RU')} ₸`;

/** Откуда взялось отличие от других карточек выдачи. */
const TIER_LABEL: Record<number, string> = {
  1: 'по полям анкеты',
  2: 'по тексту профиля',
  3: 'профили почти совпадают',
};

export default function Home() {
  const [req, setReq] = useState<MatchRequest>(SCENARIOS[0].req);
  const [wishText, setWishText] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [anon, setAnon] = useState(false);
  const [useLlm, setUseLlm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [parsed, setParsed] = useState<ParsedRequest | null>(null);
  const [parsing, setParsing] = useState(false);

  const range = META.priceRanges[`${req.category}|${req.city}`];
  const autoRan = useRef(false);

  // ?s=S3 — сразу прогнать сценарий. Удобно для ссылок и для снятия скриншотов.
  useEffect(() => {
    if (autoRan.current) return;
    const id = new URLSearchParams(window.location.search).get('s');
    const scenario = SCENARIOS.find((x) => x.id.toLowerCase() === id?.toLowerCase());
    if (!scenario) return;
    autoRan.current = true;
    runScenario(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(next: MatchRequest = req, wishes = wishText) {
    setLoading(true);
    setError(null);
    const payload: MatchRequest & { llm: boolean } = {
      ...next,
      wishes: wishes.trim() ? wishes.split(/[,;]+/).map((w) => w.trim()).filter(Boolean) : undefined,
      llm: useLlm,
    };
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Ошибка запроса');
      setData(json as ApiResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  async function parseChat() {
    if (chatText.trim().length < 3) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: chatText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Не удалось разобрать запрос');
      setParsed(json as ParsedRequest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setParsing(false);
    }
  }

  /** Подтверждение: переносим разобранное в форму. Поиск идёт от подтверждённой структуры. */
  function applyParsed() {
    if (!parsed) return;
    const next: MatchRequest = {
      city: parsed.city ?? req.city,
      category: parsed.category ?? req.category,
      date: parsed.date ?? req.date,
      eventFormat: parsed.eventFormat,
      budgetKzt: parsed.budgetKzt,
      durationHours: parsed.durationHours,
      language: parsed.language,
    };
    const wishes = parsed.wishes.join(', ');
    setReq(next);
    setWishText(wishes);
    void search(next, wishes);
  }

  function runScenario(s: Scenario) {
    const wishes = s.req.wishes?.join(', ') ?? '';
    setReq(s.req);
    setWishText(wishes);
    void search(s.req, wishes);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 text-slate-900">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Подбор подрядчиков под мероприятие</h1>
        <p className="mt-1 text-sm text-slate-600">
          До трёх карточек с объяснением, почему именно они. Каталог: 66 профилей, окно дат 23.09–31.12.2026.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-slate-300 bg-white p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Опишите мероприятие своими словами
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={chatText}
            placeholder="нужен ведущий на свадьбу в Алматы 18 ноября, бюджет до миллиона, чтобы вёл на казахском"
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void parseChat()}
          />
          <button
            onClick={() => void parseChat()}
            disabled={parsing}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {parsing ? 'Читаю…' : 'Разобрать'}
          </button>
        </div>

        {parsed && (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="font-medium">Правильно понял?</div>
            <div className="mt-1 whitespace-pre-line">{parsed.summary}</div>

            {parsed.unsupported.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                {parsed.unsupported.map((u) => (
                  <li key={u.quote}>«{u.quote}» — {u.reason}</li>
                ))}
              </ul>
            )}

            {parsed.question && <div className="mt-2 text-xs text-slate-600">{parsed.question}</div>}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={applyParsed}
                disabled={parsed.missing.length > 0}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                Всё верно, искать
              </button>
              <span className="text-xs text-slate-500">
                {parsed.missing.length > 0
                  ? `не хватает: ${parsed.missing.join(', ')} — допишите в запросе или заполните форму ниже`
                  : 'можно поправить любое поле в форме ниже'}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="mb-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Сценарии для проверки</div>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => runScenario(s)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-xs hover:border-slate-500"
            >
              <span className="font-semibold">{s.id}</span> · {s.title}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-4">
        <Field label="Город">
          <select className="input" value={req.city} onChange={(e) => setReq({ ...req, city: e.target.value })}>
            {META.cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Категория">
          <select className="input" value={req.category} onChange={(e) => setReq({ ...req, category: e.target.value })}>
            {META.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Дата">
          <input className="input" type="date" min="2026-09-23" max="2026-12-31" value={req.date}
            onChange={(e) => setReq({ ...req, date: e.target.value })} />
        </Field>
        <Field label="Формат">
          <select className="input" value={req.eventFormat ?? ''} onChange={(e) => setReq({ ...req, eventFormat: e.target.value || undefined })}>
            <option value="">любой</option>
            {META.eventFormats.map((f) => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label={`Бюджет${range ? ` · в каталоге ${money(range.min)} – ${money(range.max)}` : ''}`}>
          <input className="input" type="number" step="50000" value={req.budgetKzt ?? ''} placeholder="не указан"
            onChange={(e) => setReq({ ...req, budgetKzt: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
        <Field label="Длительность, ч">
          <input className="input" type="number" value={req.durationHours ?? ''} placeholder="не важно"
            onChange={(e) => setReq({ ...req, durationHours: e.target.value ? Number(e.target.value) : undefined })} />
        </Field>
        <Field label="Язык">
          <select className="input" value={req.language ?? ''} onChange={(e) => setReq({ ...req, language: e.target.value || undefined })}>
            <option value="">не важно</option>
            {META.languages.map((l) => <option key={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Пожелания (через запятую)">
          <input className="input" value={wishText} placeholder="например: украсит розами"
            onChange={(e) => setWishText(e.target.value)} />
        </Field>
        <div className="flex items-end gap-3 md:col-span-4">
          <button onClick={() => void search()} disabled={loading}
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {loading ? 'Ищу…' : 'Подобрать'}
          </button>
          <Toggle checked={anon} onChange={setAnon} label="стереть имена" />
          <Toggle checked={useLlm} onChange={setUseLlm} label="объяснения моделью" />
          {data && (
            <span className="ml-auto text-xs text-slate-500">
              {data.timings.totalMs} мс · объяснения: {data.explanationSource ?? '—'}
            </span>
          )}
        </div>
      </section>

      {error && <p className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {data && (
        <>
          <p className="mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed">
            <span className="mr-2 rounded bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">{data.outcome}</span>
            {data.message}
          </p>

          {data.notes.map((n) => (
            <p key={n} className="mb-2 text-xs text-amber-800">⚠ {n}</p>
          ))}

          <div className="mb-6 grid gap-3">
            {data.cards.map((c, i) => <CardView key={c.id} card={c} index={i} anon={anon} />)}
          </div>

          {data.softCards.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-sm font-semibold">Ещё может подойти, если…</h2>
              <div className="grid gap-3">
                {data.softCards.map((c, i) => <CardView key={c.id} card={c} index={data.cards.length + i} anon={anon} soft />)}
              </div>
            </section>
          )}

          {data.nearestCards.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-1 text-sm font-semibold">Ближайшее, что есть в каталоге</h2>
              <p className="mb-2 text-xs text-slate-500">
                Под ваши условия не подходит никто. Показываем ближайшие варианты и честно называем,
                насколько они расходятся с запросом.
              </p>
              <div className="grid gap-3">
                {data.nearestCards.map((c, i) => (
                  <CardView key={c.id} card={c} index={i} anon={anon} soft />
                ))}
              </div>
            </section>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold">Как мы отбирали</h2>
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {data.funnel.map((f) => (
                <span key={f.step} className="rounded bg-slate-100 px-2 py-1">
                  {f.step} <b>{f.after}</b>
                  {f.dropped > 0 && <span className="text-slate-500"> (−{f.dropped})</span>}
                </span>
              ))}
            </div>
            {data.nearMisses.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-600">
                {data.nearMisses.map((n) => (
                  <li key={n.id}>
                    <b>{anon ? n.id : n.name}</b> — отсеян на шаге «{n.droppedAt}»: {n.reason}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function CardView({ card, index, anon, soft }: { card: Card; index: number; anon: boolean; soft?: boolean }) {
  const title = anon ? `Подрядчик ${String.fromCharCode(65 + index)}` : card.name;
  return (
    <article className={`rounded-lg border p-4 ${soft ? 'border-dashed border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="text-sm text-slate-500">{card.category} · {card.city}</span>
        <span className="ml-auto text-sm font-medium">{money(card.priceFromKzt)}</span>
      </div>

      {card.relaxation && (
        <p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
          <b>{card.relaxation.label}.</b> {card.relaxation.detail}
        </p>
      )}

      {card.explanation && <p className="mt-2 text-sm leading-relaxed">{card.explanation}</p>}

      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {card.facts.hoursSpare !== undefined && <Chip>запас {card.facts.hoursSpare} ч</Chip>}
        {card.facts.budgetLeftover !== undefined && card.facts.budgetLeftover >= 0 && (
          <Chip>остаток бюджета {money(card.facts.budgetLeftover)}</Chip>
        )}
        <Chip>языки: {card.facts.languages.join(', ')}</Chip>
        <Chip>форматов: {card.facts.formatsCount}</Chip>
        {card.facts.experienceClaims.map((e) => <Chip key={e}>{e}</Chip>)}
        {card.facts.alsoListedAs.length > 0 && <Chip>также: {card.facts.alsoListedAs.join(', ')}</Chip>}
        {card.facts.priceImputed && <Chip warn>цена ориентировочная</Chip>}
        {card.facts.synthetic && <Chip warn>синтетический профиль</Chip>}
        {card.facts.wishChecks.map((w) => (
          <Chip key={w.wish} warn={!w.confirmed}>
            {w.wish}: {w.confirmed ? 'подтверждено' : 'не упомянуто в профиле'}
          </Chip>
        ))}
      </div>

      <details className="mt-2 text-[11px] text-slate-500">
        <summary className="cursor-pointer">чем отличается от других в этой выдаче</summary>
        <ul className="mt-1 list-disc pl-4">
          {card.differentiators.map((d) => (
            <li key={d.axis}>
              <span className="text-slate-400">{TIER_LABEL[d.tier]}:</span> {d.value}
            </li>
          ))}
        </ul>
        <div className="mt-1">score {card.score}</div>
      </details>
    </article>
  );
}

function Chip({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <span className={`rounded px-1.5 py-0.5 ${warn ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
      {children}
    </span>
  );
}
