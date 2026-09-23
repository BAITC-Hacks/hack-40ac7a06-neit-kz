'use client';

import { useEffect, useState } from 'react';
import { formatRuDate, humanizeDates } from '@/lib/dates';

/**
 * Страница «как это встраивается» — демонстрация применимости.
 *
 * Слева макет чужой площадки с нашим виджетом в <iframe>, справа — два способа
 * подключения: виджетом в две строки разметки и по API для тех, кому нужен
 * собственный интерфейс.
 */

const IFRAME_SNIPPET = `<iframe
  src="https://podbor.example.kz/embed?city=Алматы&category=Ведущий&date=2026-10-01"
  style="width:420px;height:640px;border:1px solid #e2e8f0;border-radius:12px"
  title="Подбор подрядчика"
></iframe>`;

const API_SNIPPET = `POST /api/match
{
  "city": "Алматы",
  "category": "Ведущий",
  "eventFormat": "корпоратив",
  "date": "2026-10-01",
  "budgetKzt": 1500000,
  "wishes": ["без пошлых конкурсов"]
}

→ { outcome, message, cards[], softCards[], nearestCards[], funnel[] }`;

type MatchedCard = {
  id: string; name: string; category: string; city: string;
  priceFromKzt: number; explanation?: string; relaxation?: string;
};

type MatchedPosition = {
  category: string;
  outcome: string;
  message: string;
  request: { city: string; category: string; date: string; eventFormat?: string; budgetKzt?: number };
  cards: MatchedCard[];
};

type MatchMessage = { type: string; positions: MatchedPosition[] };

const CATALOG_STUB = ['Куррапика', 'Мицури Канроджи', 'Джинбей', 'Хаул', 'Софи Хаттер'];

export default function IntegrationPage() {
  const [tab, setTab] = useState<'iframe' | 'api'>('iframe');
  const [matched, setMatched] = useState<MatchMessage | null>(null);

  // Площадка слушает виджет и показывает подборку в своём каталоге, своими кнопками.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as MatchMessage | undefined;
      if (data?.type === 'podbor:match' && Array.isArray(data.positions)) setMatched(data);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const snippet = tab === 'iframe' ? IFRAME_SNIPPET : API_SNIPPET;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен — текст всё равно виден */
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Как это встраивается в площадку</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Решение не привязано к нашему каталогу — это надстройка над любой базой подрядчиков.
          Ниже макет чужого сайта с нашим виджетом внутри и два способа подключения.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        {/* Макет площадки-партнёра */}
        <section>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            Сайт площадки (макет)
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-300">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <b className="text-sm">EventBase.kz</b>
              <nav className="flex gap-3 text-xs text-slate-500">
                <span>Каталог</span><span>Площадки</span><span>Как это работает</span>
              </nav>
            </div>

            <div className="grid gap-4 p-4 md:grid-cols-[1fr_400px]">
              <div>
                {matched ? (
                  <>
                    <h2 className="text-sm font-semibold">Подходят под ваш запрос</h2>
                    <p className="mb-3 text-[11px] text-slate-500">
                      {matched.positions.length > 1
                        ? `${matched.positions.length} позиции, отобраны виджетом`
                        : 'отобрано виджетом'}
                    </p>

                    <div className="space-y-4">
                      {matched.positions.map((pos) => (
                        <div key={pos.category}>
                          <div className="mb-1 flex items-baseline gap-2">
                            <b className="text-xs">{pos.category}</b>
                            <span className="text-[11px] text-slate-400">
                              {pos.request.city} · {formatRuDate(pos.request.date)}
                              {pos.request.budgetKzt
                                ? ` · до ${pos.request.budgetKzt.toLocaleString('ru-RU')} ₸`
                                : ''}
                            </span>
                          </div>
                          {pos.cards.length === 0 && (
                            <p className="text-[11px] text-slate-500">{humanizeDates(pos.message)}</p>
                          )}
                          <div className="space-y-2">
                            {pos.cards.map((c) => (
                              <div key={c.id} className="rounded-lg border border-blue-200 bg-blue-50/40 p-2">
                                <div className="flex items-center gap-3">
                                  <div className="h-10 w-10 rounded bg-slate-200" />
                                  <div className="flex-1">
                                    <div className="text-sm">{c.name}</div>
                                    <div className="text-[11px] text-slate-400">
                                      {c.category} · {c.city} · {c.priceFromKzt.toLocaleString('ru-RU')} ₸
                                      {c.relaxation ? ` · ${c.relaxation}` : ''}
                                    </div>
                                  </div>
                                  <button className="rounded bg-blue-600 px-2 py-1 text-[11px] text-white">
                                    Написать
                                  </button>
                                </div>
                                {c.explanation && (
                                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{humanizeDates(c.explanation)}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <p className="mt-3 text-[11px] text-slate-400">
                      Каталог площадки обновился сам: виджет отдал подборку через postMessage,
                      а карточки и кнопка «Написать» — собственные, площадки.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-sm font-semibold">Ведущие в Алматы</h2>
                    <p className="mb-3 text-xs text-slate-500">найдено 10 анкет</p>
                    <div className="space-y-2">
                      {CATALOG_STUB.map((n) => (
                        <div key={n} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2">
                          <div className="h-10 w-10 rounded bg-slate-200" />
                          <div className="flex-1">
                            <div className="text-sm">{n}</div>
                            <div className="text-[11px] text-slate-400">Ведущий · Алматы</div>
                          </div>
                          <button className="rounded border border-slate-300 px-2 py-1 text-[11px]">Написать</button>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-slate-400">
                      Обычный каталог: список анкет, в котором клиент сам перебирает,
                      кто свободен на его дату и укладывается в бюджет.
                      Ответьте виджету справа — список слева перестроится.
                    </p>
                  </>
                )}
              </div>

              <div>
                <div className="mb-1 text-[11px] text-slate-400">наш виджет, встроенный через iframe ↓</div>
                <iframe
                  src="/embed?city=Алматы&category=Ведущий&format=корпоратив&date=2026-10-01&budget=1500000"
                  title="Подбор подрядчика"
                  className="h-[560px] w-full rounded-xl border border-slate-300"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Способы подключения */}
        <section>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Подключение</div>

          <div className="mb-3 flex gap-2">
            <button
              onClick={() => setTab('iframe')}
              className={`rounded-lg px-3 py-1.5 text-xs ${tab === 'iframe' ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
            >
              Виджетом
            </button>
            <button
              onClick={() => setTab('api')}
              className={`rounded-lg px-3 py-1.5 text-xs ${tab === 'api' ? 'bg-slate-900 text-white' : 'border border-slate-300'}`}
            >
              По API
            </button>
          </div>

          <div className="relative">
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
              {snippet}
            </pre>
            <button
              onClick={() => void copy()}
              className="absolute right-3 top-3 rounded bg-white/10 px-2 py-1 text-[11px] text-white"
            >
              {copied ? 'скопировано' : 'копировать'}
            </button>
          </div>

          {tab === 'iframe' ? (
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              <li>• Две строки разметки, ничего на бэкенде площадки менять не нужно.</li>
              <li>• Параметры <code className="text-xs">city</code> и <code className="text-xs">category</code> передают то,
                  что площадка уже знает: клиент попадает в диалог с заполненным контекстом.</li>
              <li>• Виджет ведёт диалог сам: уточняет дату и бюджет, показывает подбор с объяснениями
                  и честно говорит, если подходящих нет.</li>
            </ul>
          ) : (
            <ul className="mt-4 space-y-2 text-sm text-slate-700">
              <li>• Для площадок со своим интерфейсом: тот же движок отдаёт JSON.</li>
              <li>• В ответе не только карточки, но и воронка отсева — можно показать клиенту своими средствами.</li>
              <li>• Разбор свободного запроса — отдельным вызовом <code className="text-xs">POST /api/parse</code>,
                  он же держит диалог: предыдущее состояние передаётся полем <code className="text-xs">known</code>.</li>
            </ul>
          )}

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <b className="block text-sm">Что нужно от площадки</b>
            <p className="mt-1 text-slate-600">
              Доступ к своим профилям: выгрузка или API. Переделывать каталог не требуется —
              мы работаем с теми полями, которые у площадки уже есть: категория, город, цена,
              календарь занятости и текстовое описание.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
