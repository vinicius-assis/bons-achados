"use client";

import { useCallback, useEffect, useState } from "react";
import { parseDiscountPercentage } from "@/lib/mercadolivre/discountLabel";
import { isValidNote } from "@/lib/highlights/note";
import { NOTE_TEMPLATES } from "@/lib/highlights/noteTemplates";

type AmazonDealItem = {
  asin: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  image: string;
  permalink: string;
  affiliateLink: string;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${active ? "bg-gold" : "bg-alert"}`}
    />
  );
}

export default function AmazonAdmin() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [curlCommand, setCurlCommand] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [items, setItems] = useState<AmazonDealItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [copiedAsin, setCopiedAsin] = useState<string | null>(null);
  const [selectingAsin, setSelectingAsin] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [highlightingAsin, setHighlightingAsin] = useState<string | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/amazon/session")
      .then((response) => response.json())
      .then((body) => setHasSession(Boolean(body.hasSession)))
      .catch(() => setHasSession(false));
  }, []);

  const expireSession = useCallback(() => {
    setHasSession(false);
    setShowSessionForm(true);
    setSessionError("A sessão da Amazon expirou. Cole os cookies novamente.");
  }, []);

  async function handleSaveSession(event: React.FormEvent) {
    event.preventDefault();
    setSavingSession(true);
    setSessionError(null);
    try {
      const response = await fetch("/api/admin/amazon/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curlCommand }),
      });
      if (!response.ok) {
        setSessionError(
          "Não achei o Cookie nesse curl. Confirma que copiou a requisição products/search inteira e tenta de novo."
        );
        return;
      }
      setHasSession(true);
      setShowSessionForm(false);
      setCurlCommand("");
      setLoadError(null);
    } catch {
      setSessionError("Não deu para salvar a sessão. Verifique a conexão e tente de novo.");
    } finally {
      setSavingSession(false);
    }
  }

  const fetchPage = useCallback(async (offset: number) => {
    const response = await fetch(`/api/admin/amazon/deals?offset=${offset}`);
    if (response.status === 401) {
      expireSession();
      return null;
    }
    const body = await response.json();
    if (!response.ok) {
      throw new Error("deals_failed");
    }
    return { items: body.items as AmazonDealItem[], nextIndex: body.nextIndex as number | null };
  }, [expireSession]);

  const loadPage = useCallback(
    async (offset: number, mode: "replace" | "append") => {
      const setLoadingState = mode === "replace" ? setLoading : setLoadingMore;
      setLoadingState(true);
      setLoadError(null);
      try {
        const page = await fetchPage(offset);
        if (page === null) {
          return;
        }
        setItems((previous) => (mode === "replace" ? page.items : [...previous, ...page.items]));
        setNextOffset(page.items.length > 0 ? page.nextIndex : null);
        setLoaded(true);
      } catch {
        setLoadError(
          mode === "replace"
            ? "A listagem falhou. Tente de novo em alguns segundos."
            : "Não deu para carregar mais ofertas. Tente de novo em alguns segundos."
        );
      } finally {
        setLoadingState(false);
      }
    },
    [fetchPage]
  );

  // One-shot "load on session ready" effect, same pattern as the ML admin
  // page — not a live query sync, so it intentionally only depends on
  // hasSession.
  useEffect(() => {
    if (!hasSession) {
      return;
    }
    queueMicrotask(() => {
      void loadPage(0, "replace");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSession]);

  async function handleLoadMore() {
    if (nextOffset === null) {
      return;
    }
    await loadPage(nextOffset, "append");
  }

  async function handleSelectForPost(item: AmazonDealItem) {
    setSelectingAsin(item.asin);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "AMAZON",
          source: "AUTO",
          title: item.title,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          discount: parseDiscountPercentage(item.discountLabel),
          category: null,
        }),
      });
      if (response.status === 409) {
        setSelectedForPost((previous) => ({ ...previous, [item.asin]: true }));
        return;
      }
      if (!response.ok) {
        setLoadError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.asin]: true }));
    } catch {
      setLoadError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingAsin(null);
    }
  }

  async function handleHighlight(item: AmazonDealItem, note: string) {
    setHighlightingAsin(item.asin);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "AMAZON",
          title: item.title,
          note,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          oldPrice: item.oldPrice,
          discount: parseDiscountPercentage(item.discountLabel),
        }),
      });
      if (!response.ok) {
        setLoadError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
        return;
      }
      setHighlightedItems((previous) => ({ ...previous, [item.asin]: true }));
    } catch {
      setLoadError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
    } finally {
      setHighlightingAsin(null);
    }
  }

  async function handleCopy(asin: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedAsin(asin);
      window.setTimeout(() => setCopiedAsin(null), 2000);
    } catch {
      setLoadError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
    }
  }

  const sessionFormVisible = hasSession === false || showSessionForm;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Amazon</p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Ofertas do <span className="text-gold">mês</span>
          </h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-ink-line bg-ink-raised px-3 py-1.5">
          <StatusDot active={hasSession === true} />
          <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
            {hasSession === null ? "verificando" : hasSession ? "sessão ativa" : "sem sessão"}
          </span>
        </div>
      </div>

      <div className="mt-8">
        {hasSession === null && (
          <p className="font-mono text-sm text-ash">Verificando a sessão da Amazon…</p>
        )}

        {sessionFormVisible && (
          <section className="mb-10 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <h2 className="font-display font-stretch-condensed text-xl font-black tracking-tight text-gold uppercase italic">
              Conectar a sessão da Amazon
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ash">
              A página de ofertas do mês não tem API pública, então o painel reusa a sua sessão
              do navegador. Ela costuma durar bastante tempo.
            </p>

            <ol className="mt-5 max-w-2xl space-y-3 text-sm text-paper/80">
              {[
                <>
                  Abra{" "}
                  <a
                    href="https://www.amazon.com.br/events/ofertasmensais"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    amazon.com.br/events/ofertasmensais
                  </a>{" "}
                  logado na sua conta.
                </>,
                <>
                  No DevTools (F12), vá para a aba{" "}
                  <strong className="font-semibold text-paper">Network</strong> e role a página
                  pra carregar mais ofertas.
                </>,
                <>
                  Clique com o botão direito na requisição{" "}
                  <code className="font-mono text-gold">products/search</code>, escolha{" "}
                  <strong className="font-semibold text-paper">Copy → Copy as cURL</strong>.
                </>,
                <>Cole o curl inteiro no campo abaixo — o painel extrai o Cookie sozinho.</>,
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="mt-px shrink-0 font-mono text-xs text-gold tabular-nums">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <form onSubmit={handleSaveSession} className="mt-7 space-y-4">
              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">
                  Curl da requisição products/search
                </span>
                <textarea
                  required
                  value={curlCommand}
                  onChange={(event) => setCurlCommand(event.target.value)}
                  placeholder="curl --url 'https://www.amazon.com.br/d2b/api/v1/products/search…"
                  rows={8}
                  className="mt-2 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              {sessionError && (
                <p role="alert" className="text-sm text-alert">
                  {sessionError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={savingSession}
                  className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSession ? "Salvando…" : "Salvar sessão"}
                </button>
                {hasSession && (
                  <button
                    type="button"
                    onClick={() => setShowSessionForm(false)}
                    className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </section>
        )}

        {hasSession && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p aria-live="polite" className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
                {loading
                  ? "carregando…"
                  : items.length > 0
                    ? `${items.length} oferta${items.length === 1 ? "" : "s"}`
                    : ""}
              </p>
              {!showSessionForm && (
                <button
                  type="button"
                  onClick={() => setShowSessionForm(true)}
                  className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Trocar sessão
                </button>
              )}
            </div>

            {loadError && (
              <p
                role="alert"
                className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
              >
                {loadError}
              </p>
            )}

            {loaded && items.length === 0 && !loading && !loadError && (
              <p className="mt-10 text-sm text-ash">Nenhuma oferta disponível agora.</p>
            )}

            {!loaded && loading && (
              <p className="mt-10 text-sm text-ash">Carregando as ofertas do mês…</p>
            )}

            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, index) => (
                <article
                  key={item.asin}
                  style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
                  className="flex animate-sticker-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)]"
                >
                  <div className="relative bg-white p-3">
                    {item.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image}
                        alt=""
                        loading="lazy"
                        className="mx-auto h-40 w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center font-mono text-xs text-ash">
                        sem imagem
                      </div>
                    )}
                    {item.discountLabel && (
                      <span className="absolute bottom-3 left-3 rounded-md bg-ink px-2 py-0.5 font-display font-stretch-condensed text-xs font-black text-gold italic">
                        {item.discountLabel}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-3 border-t border-ink/10 p-4">
                    <h2 className="line-clamp-2 text-sm leading-snug font-medium text-ink">
                      {item.title}
                    </h2>

                    <div className="flex items-baseline gap-2">
                      <span className="font-display font-stretch-condensed text-2xl leading-none font-black tracking-tight text-ink tabular-nums">
                        {formatPrice(item.price)}
                      </span>
                      {item.oldPrice !== null && (
                        <span className="font-mono text-xs text-ash line-through tabular-nums">
                          {formatPrice(item.oldPrice)}
                        </span>
                      )}
                    </div>

                    <div className="mt-auto pt-1">
                      <div className="rounded-xl border border-ink/15 bg-ink/[0.04] p-2">
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            aria-label={`Link de afiliado de ${item.title}`}
                            value={item.affiliateLink}
                            onFocus={(event) => event.currentTarget.select()}
                            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink focus-visible:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleCopy(item.asin, item.affiliateLink)}
                            className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                          >
                            {copiedAsin === item.asin ? "Copiado" : "Copiar"}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectForPost(item)}
                        disabled={selectingAsin === item.asin || selectedForPost[item.asin]}
                        className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {selectedForPost[item.asin]
                          ? "Selecionado ✓"
                          : selectingAsin === item.asin
                            ? "Selecionando…"
                            : "Selecionar para postar"}
                      </button>
                      {!highlightedItems[item.asin] && (
                        <>
                          <select
                            value=""
                            onChange={(event) => {
                              const template = event.target.value;
                              if (!template) {
                                return;
                              }
                              setNoteDrafts((previous) => ({ ...previous, [item.asin]: template }));
                              event.target.value = "";
                            }}
                            className="mt-2 w-full rounded-xl border border-ink/15 bg-ink/[0.04] p-2 font-mono text-[11px] text-ink focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                          >
                            <option value="">Usar um modelo de nota…</option>
                            {NOTE_TEMPLATES.map((template) => (
                              <option key={template} value={template}>
                                {template}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={noteDrafts[item.asin] ?? ""}
                            onChange={(event) =>
                              setNoteDrafts((previous) => ({
                                ...previous,
                                [item.asin]: event.target.value,
                              }))
                            }
                            placeholder="Por que essa oferta vale a pena? (mín. 15 caracteres)"
                            rows={2}
                            className="mt-2 w-full resize-y rounded-xl border border-ink/15 bg-ink/[0.04] p-2 font-mono text-[11px] text-ink placeholder:text-ink/40 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
                          />
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleHighlight(item, (noteDrafts[item.asin] ?? "").trim())}
                        disabled={
                          highlightingAsin === item.asin ||
                          highlightedItems[item.asin] ||
                          !isValidNote(noteDrafts[item.asin] ?? "")
                        }
                        className="mt-2 w-full rounded-full border border-ink/15 bg-ink/[0.04] px-4 py-2 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-ink hover:text-gold focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {highlightedItems[item.asin]
                          ? "Na vitrine ✓"
                          : highlightingAsin === item.asin
                            ? "Destacando…"
                            : "Destacar na vitrine"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {nextOffset !== null && items.length > 0 && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-ink-line bg-ink-raised px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingMore ? "Carregando…" : "Carregar mais"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
