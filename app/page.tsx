'use client';

import { useEffect, useRef, useState } from 'react';
import scenarios from '@/data/scenarios.json';
import meta from '@/data/meta.json';
import type { Card, MatchRequest, MatchResponse } from '@/lib/types';

type Scenario = { id: string; title: string; req: MatchRequest };
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

/**
 * Три исхода ТЗ должны различаться явно, поэтому код исхода показываем словами.
 * Незнакомое значение отрисуется нейтрально и покажет сам код — экран не ломается.
 */
const OUTCOME_LABEL: Record<string, { title: string; tone: string }> = {
  MATCHED: { title: 'Подобрали', tone: 'o-good' },
  NO_CATEGORY_IN_CITY: { title: 'В этом городе таких нет', tone: 'o-flat' },
  NO_FORMAT_IN_POOL: { title: 'Этот формат не берут', tone: 'o-flat' },
  NO_ONE_PASSES: { title: 'Под ваши условия никто не подходит', tone: 'o-warn' },
};

export default function Home() {
  const [req, setReq] = useState<MatchRequest>(SCENARIOS[0].req);
  const [wishText, setWishText] = useState('');
  const [data, setData] = useState<ApiResponse | null>(null);
  /** Несколько позиций в одном запросе: «ведущий и фотограф» — два подбора со своими бюджетами. */
  const [multi, setMulti] = useState<Array<{ title: string; data: ApiResponse }>>([]);
  const [loading, setLoading] = useState(false);
  const [anon, setAnon] = useState(false);
  const [useLlm, setUseLlm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [brief, setBrief] = useState<Brief | null>(null);
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
    setMulti([]);
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
      const res = await fetch('/api/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: chatText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Не удалось разобрать запрос');
      setBrief(json as Brief);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setParsing(false);
    }
  }

  /**
   * Подтверждение: поиск идёт от подтверждённой структуры, а не от текста.
   * Позиций может быть несколько — тогда подбор запускается по каждой отдельно,
   * со своим бюджетом и пожеланиями.
   */
  async function applyParsed() {
    if (!brief || brief.positions.length === 0) return;
    setMulti([]);
    setData(null);

    const first = brief.positions[0];
    const asRequest = (p: Position): MatchRequest => ({
      city: p.city ?? req.city,
      category: p.category,
      date: p.date ?? req.date,
      eventFormat: p.eventFormat,
      budgetKzt: p.budgetKzt,
      durationHours: p.durationHours,
      language: p.language,
    });

    setReq(asRequest(first));
    setWishText(first.wishes.join(', '));

    if (brief.positions.length === 1) {
      void search(asRequest(first), first.wishes.join(', '));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const blocks: Array<{ title: string; data: ApiResponse }> = [];
      for (const p of brief.positions) {
        const res = await fetch('/api/match', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...asRequest(p),
            wishes: p.wishes.length ? p.wishes : undefined,
            llm: useLlm,
          }),
        });
        const json = await res.json();
        if (!res.ok) continue;
        const title = [p.category, p.budgetKzt ? `до ${p.budgetKzt.toLocaleString('ru-RU')} ₸` : null]
          .filter(Boolean)
          .join(' · ');
        blocks.push({ title, data: json as ApiResponse });
      }
      setMulti(blocks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }

  function runScenario(s: Scenario) {
    const wishes = s.req.wishes?.join(', ') ?? '';
    setReq(s.req);
    setWishText(wishes);
    void search(s.req, wishes);
  }

  const blocks: Array<{ title?: string; data: ApiResponse }> =
    multi.length > 0 ? multi : data ? [{ data }] : [];

  return (
    <>
      <header className="topbar">
        <div className="brand">
          neIT.kz <span>· подбор подрядчиков</span>
        </div>
        <div className="topbar-meta">
          66 профилей · окно 23.09 — 31.12.2026
          {data && (
            <>
              <br />
              ответ за {data.timings.totalMs} мс · объяснения: {data.explanationSource ?? '—'}
            </>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-7 py-10">
        <h1 className="hero-title">Кого можно позвать на ваше мероприятие</h1>
        <p className="hero-lead">
          Опишите событие своими словами. Вернём до трёх подрядчиков и скажем, почему именно они —
          и кого отсеяли по дороге.
        </p>
        <p className="mt-2 text-sm">
          <a href="/integration" className="underline underline-offset-2">
            Как это встроить в свою площадку →
          </a>
        </p>

        <section className="mt-7">
          <div className="flex max-w-3xl gap-2.5">
            <input
              className="input ask-input flex-1"
              value={chatText}
              placeholder="нужен ведущий на свадьбу в Алматы 18 ноября, бюджет до миллиона, чтобы вёл на казахском"
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void parseChat()}
            />
            <button onClick={() => void parseChat()} disabled={parsing} className="btn btn-lg btn-primary">
              {parsing ? 'Читаю…' : 'Разобрать'}
            </button>
          </div>

          {brief && (
            <div className="understood mt-5 max-w-3xl">
              <div className="understood-h">
                {brief.positions.length > 1 ? `Понял ${brief.positions.length} позиции` : 'Понял так'}
              </div>

              {brief.positions.length > 0 ? (
                <ul className="space-y-1">
                  {brief.positions.map((p) => (
                    <li key={p.category}>
                      {brief.positions.length > 1 && '• '}
                      {p.summary}
                      {p.wishes.length > 0 && (
                        <span style={{ color: 'var(--muted)' }}> · пожелания: {p.wishes.join(', ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <div style={{ color: 'var(--muted)' }}>пока ничего не понял</div>
              )}

              {(brief.notes ?? []).map((n) => (
                <div key={n} className="mt-2.5 text-[13px]" style={{ color: 'var(--warn)' }}>
                  ⚠ {n}
                </div>
              ))}

              {brief.unsupported.length > 0 && (
                <ul className="mt-2.5 space-y-1 text-[13px]" style={{ color: 'var(--warn)' }}>
                  {brief.unsupported.map((u, i) => (
                    <li key={`${u.quote}-${i}`}>«{u.quote}» — {u.reason}</li>
                  ))}
                </ul>
              )}

              {brief.question && (
                <div className="mt-2.5 text-[13px]" style={{ color: 'var(--muted)' }}>
                  {brief.question}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2.5">
                <button
                  onClick={() => void applyParsed()}
                  disabled={brief.positions.length === 0 || brief.positions.some((p) => p.missing.length > 0)}
                  className="btn btn-go"
                >
                  {brief.positions.length > 1 ? `Искать по ${brief.positions.length} позициям` : 'Всё верно, искать'}
                </button>
                <span className="text-[13px]" style={{ color: 'var(--faint)' }}>
                  {brief.positions.some((p) => p.missing.length > 0)
                    ? `не хватает: ${[...new Set(brief.positions.flatMap((p) => p.missing))].join(', ')} — допишите в запросе или заполните форму ниже`
                    : 'можно поправить любое поле в форме ниже'}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="mt-8">
          <div className="sec-h">Сценарии для проверки</div>
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <button key={s.id} onClick={() => runScenario(s)} className="pill">
                <b style={{ color: 'var(--ink)' }}>{s.id}</b> · {s.title}
              </button>
            ))}
          </div>
        </section>

        <section
          className="mt-6 grid gap-3.5 rounded-[14px] p-5 md:grid-cols-4"
          style={{ background: 'var(--soft)', border: '1px solid var(--line)' }}
        >
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
          <div className="flex flex-wrap items-center gap-4 md:col-span-4">
            <button onClick={() => void search()} disabled={loading} className="btn btn-primary">
              {loading ? 'Ищу…' : 'Подобрать'}
            </button>
            <Toggle checked={anon} onChange={setAnon} label="стереть имена" />
            <Toggle checked={useLlm} onChange={setUseLlm} label="объяснения моделью" />
          </div>
        </section>

        {error && (
          <p className="mt-5 rounded-[10px] p-3.5 text-sm" style={{ background: '#fdece9', color: 'var(--bad)' }}>
            {error}
          </p>
        )}

        {blocks.map((b) => (
          <ResultBlock key={b.title ?? 'one'} data={b.data} title={b.title} anon={anon} />
        ))}
      </main>
    </>
  );
}

/** Один результат подбора: исход, карточки, послабления, ближайшее и воронка. */
function ResultBlock({
  data,
  title,
  anon,
}: {
  data: ApiResponse;
  title?: string;
  anon: boolean;
}) {
  const outcome = OUTCOME_LABEL[data.outcome] ?? { title: data.outcome, tone: 'o-flat' };
  return (
    <>
      {title && <h2 className="sec-h mt-10">{title}</h2>}

            <div className={`outcome mt-9 ${outcome.tone}`}>
              <span className="outcome-tag">{outcome.title}</span>
              <p>{data.message}</p>
            </div>

            {data.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-[13px]" style={{ color: 'var(--warn)' }}>
                {data.notes.map((n) => <li key={n}>⚠ {n}</li>)}
              </ul>
            )}

            {data.cards.length > 0 && (
              <section className="mt-8">
                <div className="flex flex-col gap-3">
                  {data.cards.map((c, i) => <CardView key={c.id} card={c} index={i} anon={anon} />)}
                </div>
              </section>
            )}

            {data.softCards.length > 0 && (
              <section className="mt-8">
                <h2 className="sec-h">Ещё может подойти, если…</h2>
                <div className="flex flex-col gap-3">
                  {data.softCards.map((c, i) => (
                    <CardView key={c.id} card={c} index={data.cards.length + i} anon={anon} soft />
                  ))}
                </div>
              </section>
            )}

            {data.nearestCards.length > 0 && (
              <section className="mt-8">
                <h2 className="sec-h">
                  Ближайшее, что есть в каталоге
                  <span className="sec-sub">
                    Под ваши условия не подходит никто. Показываем ближайшие варианты и честно называем,
                    насколько они расходятся с запросом.
                  </span>
                </h2>
                <div className="flex flex-col gap-3">
                  {data.nearestCards.map((c, i) => <CardView key={c.id} card={c} index={i} anon={anon} soft />)}
                </div>
              </section>
            )}

            <section className="funnel-box mt-9">
              <div className="flex items-baseline gap-2">
                <h2>Как мы отбирали</h2>
                {/* Технический код исхода — здесь он к месту: это раздел про пайплайн. */}
                <code className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  исход: {data.outcome}
                </code>
              </div>
              <p className="funnel-cap">
                Семь жёстких фильтров в фиксированном порядке. Тот же запрос всегда даёт тот же порядок карточек.
              </p>
              <ul className="steps">
                {data.funnel.length > 0 && (
                  <li className="step-start">
                    <span className="step-n">{data.funnel[0].before}</span>{' '}
                    <span className="step-name">в каталоге</span>
                  </li>
                )}
                {data.funnel.map((f) => (
                  <li key={f.step} className={f.after === 0 ? 'step-zero' : undefined}>
                    <span className="step-n">{f.after}</span> <span className="step-name">{f.step}</span>
                    {f.dropped > 0 && <span className="step-drop"> −{f.dropped}</span>}
                    <span className="step-why">{f.reason}</span>
                  </li>
                ))}
              </ul>

              {data.nearMisses.length > 0 && (
                <>
                  <div className="rej-h">Кто не прошёл</div>
                  <ul className="rej">
                    {data.nearMisses.map((n) => (
                      <li key={n.id}>
                        <span className="rej-who">{anon ? n.id : n.name}</span>
                        <span className="rej-why">{n.reason}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--muted)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function CardView({ card, index, anon, soft }: { card: Card; index: number; anon: boolean; soft?: boolean }) {
  const title = anon ? `Подрядчик ${String.fromCharCode(65 + index)}` : card.name;
  return (
    <article className={`card${soft ? ' card-soft' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <div className="card-name">{title}</div>
          <div className="card-meta">{card.category} · {card.city}</div>
        </div>
        <div className="card-price">{money(card.priceFromKzt)}</div>
      </div>

      {card.relaxation && (
        <p className="relax">
          <b>{card.relaxation.label}.</b> {card.relaxation.detail}
        </p>
      )}

      {card.relaxation?.travel && (
        <div className="travel">
          <div className="font-semibold">
            ✈️ {card.city} → место мероприятия и обратно: от {money(card.relaxation.travel.totalKzt)}
            <span className="font-normal">
              {' '}· {money(card.relaxation.travel.perPersonKzt)} × {card.relaxation.travel.headcount}{' '}
              {card.relaxation.travel.headcount > 1 ? 'человек' : 'человека'}
              {card.relaxation.travel.basis === 'median' && ' · по медиане месяца, цены на этот день в снимке нет'}
            </span>
          </div>
          <div className="mt-1">
            {card.relaxation.travel.headcount > 1 && 'Состав — наше допущение, поля о составе в анкете нет. '}
            Тариф минимальный: без багажа и без проживания — по факту выйдет дороже. Ночной поезд дешевле в 2–3 раза.
          </div>
          <div className="travel-fine">Снимок цен Aviasales от 23.09.2026 · все допущения — в README</div>
        </div>
      )}

      {card.explanation && <p className="card-why">{card.explanation}</p>}

      <div className="chips">
        {card.facts.hoursSpare !== undefined && <Chip>запас {card.facts.hoursSpare} ч</Chip>}
        {card.facts.budgetLeftover !== undefined && card.facts.budgetLeftover >= 0 && (
          <Chip good>
            остаток бюджета{card.relaxation?.travel ? ' без проезда' : ''} {money(card.facts.budgetLeftover)}
          </Chip>
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
            {w.source === 'semantic' && w.score !== undefined && ` · по смыслу ${w.score.toFixed(2)}`}
            {w.source === 'lexical' && ' · по словам, семантика без ключа недоступна'}
          </Chip>
        ))}
      </div>

      <details className="diff">
        <summary>чем отличается от других в этой выдаче</summary>
        <ul>
          {card.differentiators.map((d) => (
            <li key={d.axis}>
              <span className="diff-tier">{TIER_LABEL[d.tier]}:</span> {d.value}
            </li>
          ))}
        </ul>
        <div className="diff-score">score {card.score}</div>
      </details>
    </article>
  );
}

function Chip({ children, warn, good }: { children: React.ReactNode; warn?: boolean; good?: boolean }) {
  return <span className={`chip${warn ? ' chip-warn' : good ? ' chip-good' : ''}`}>{children}</span>;
}
