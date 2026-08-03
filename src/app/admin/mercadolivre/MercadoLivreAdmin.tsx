"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";

type MLHubItem = {
  itemId: string;
  title: string;
  price: number;
  oldPrice: number | null;
  discountLabel: string | null;
  rating: number | null;
  soldLabel: string | null;
  image: string;
  permalink: string;
  commissionLabel: string | null;
  generatedLink: string | null;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Mercado Livre's hub doesn't return a total count or a "has more" flag —
// a page shorter than this is treated as the last one.
const PAGE_SIZE = 30;

/**
 * The commission chip is drawn as the price tag from the logo mark: a notched
 * point on the left, a punched hole, slapped on at a slight angle.
 */
function CommissionTag({ label }: { label: string }) {
  return (
    <span
      className="pointer-events-none inline-flex -rotate-3 items-center gap-1.5 bg-gold py-1 pr-3 pl-4 font-display font-stretch-condensed text-[11px] font-black tracking-wide text-ink uppercase italic shadow-[0_2px_0_0_var(--color-gold-deep)]"
      style={{ clipPath: "polygon(0 50%, 10px 0, 100% 0, 100% 100%, 10px 100%)" }}
    >
      <span className="size-[5px] rounded-full bg-ink/70" aria-hidden="true" />
      <span className="sr-only">Comissão de</span>
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${active ? "bg-gold" : "bg-alert"}`}
    />
  );
}

export default function MercadoLivreAdmin() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [curlCommand, setCurlCommand] = useState("");
  const [savingSession, setSavingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<MLHubItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [generatingItemId, setGeneratingItemId] = useState<string | null>(null);
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({});
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/mercadolivre/session")
      .then((response) => response.json())
      .then((body) => setHasSession(Boolean(body.hasSession)))
      .catch(() => setHasSession(false));
  }, []);

  const expireSession = useCallback(() => {
    setHasSession(false);
    setShowSessionForm(true);
    // Surfaced in the session panel, since the results area unmounts with the session.
    setSessionError("A sessão do Mercado Livre expirou. Cole os cookies novamente.");
  }, []);

  async function handleSaveSession(event: React.FormEvent) {
    event.preventDefault();
    setSavingSession(true);
    setSessionError(null);
    try {
      const response = await fetch("/api/admin/mercadolivre/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curlCommand }),
      });
      if (!response.ok) {
        setSessionError(
          "Não achei o Cookie e o x-csrf-token nesse curl. Confirma que copiou a requisição hub/search inteira e tenta de novo."
        );
        return;
      }
      setHasSession(true);
      setShowSessionForm(false);
      setCurlCommand("");
      setSearchError(null);
    } catch {
      setSessionError("Não deu para salvar a sessão. Verifique a conexão e tente de novo.");
    } finally {
      setSavingSession(false);
    }
  }

  function mergeGeneratedLinks(fetchedItems: MLHubItem[]) {
    setGeneratedLinks((previous) => {
      const next = { ...previous };
      for (const fetchedItem of fetchedItems) {
        if (fetchedItem.generatedLink) {
          next[fetchedItem.itemId] = fetchedItem.generatedLink;
        }
      }
      return next;
    });
  }

  async function fetchPage(offset: number): Promise<MLHubItem[] | null> {
    const response = await fetch(
      `/api/admin/mercadolivre/search?q=${encodeURIComponent(query)}&offset=${offset}`
    );
    if (response.status === 401) {
      expireSession();
      return null;
    }
    const body = await response.json();
    if (!response.ok) {
      throw new Error("search_failed");
    }
    return Array.isArray(body.items) ? body.items : [];
  }

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const fetchedItems = await fetchPage(0);
      if (fetchedItems === null) {
        return;
      }
      setItems(fetchedItems);
      mergeGeneratedLinks(fetchedItems);
      setHasMore(fetchedItems.length >= PAGE_SIZE);
      setSearched(true);
    } catch {
      setSearchError("A busca falhou. Tente de novo em alguns segundos.");
    } finally {
      setSearching(false);
    }
  }

  async function handleLoadMore() {
    setLoadingMore(true);
    setSearchError(null);
    try {
      const fetchedItems = await fetchPage(items.length);
      if (fetchedItems === null) {
        return;
      }
      setItems((previous) => [...previous, ...fetchedItems]);
      mergeGeneratedLinks(fetchedItems);
      setHasMore(fetchedItems.length >= PAGE_SIZE);
    } catch {
      setSearchError("Não deu para carregar mais produtos. Tente de novo em alguns segundos.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleGenerateLink(item: MLHubItem) {
    setGeneratingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/mercadolivre/generate-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          itemId: item.itemId,
          url: item.permalink,
          title: item.title,
        }),
      });
      if (response.status === 401) {
        expireSession();
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        setSearchError(`Não deu para gerar o link de "${item.title}". Tente de novo.`);
        return;
      }
      setGeneratedLinks((previous) => ({
        ...previous,
        [item.itemId]: body.affiliateLink,
      }));
    } catch {
      setSearchError(`Não deu para gerar o link de "${item.title}". Tente de novo.`);
    } finally {
      setGeneratingItemId(null);
    }
  }

  async function handleCopy(itemId: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedItemId(itemId);
      window.setTimeout(() => setCopiedItemId(null), 2000);
    } catch {
      setSearchError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
    }
  }

  const sessionFormVisible = hasSession === false || showSessionForm;

  return (
    <div className="min-h-screen bg-ink font-body text-paper">
      {/* Header: ink band with the sticker mark and a gold rule underneath */}
      <header className="border-b border-ink-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-4 px-6 py-7">
          <Image
            src="/bons-achados.png"
            alt=""
            width={52}
            height={52}
            className="shrink-0 rounded-full"
            priority
          />
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
              Bons Achados · Painel interno
            </p>
            <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
              Hub de <span className="text-gold">afiliados</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-ink-line bg-ink-raised px-3 py-1.5">
            <StatusDot active={hasSession === true} />
            <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
              {hasSession === null
                ? "verificando"
                : hasSession
                  ? "sessão ativa"
                  : "sem sessão"}
            </span>
          </div>
        </div>
        <div className="h-1 bg-gold" />
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {hasSession === null && (
          <p className="font-mono text-sm text-ash">Verificando a sessão do Mercado Livre…</p>
        )}

        {sessionFormVisible && (
          <section className="mb-10 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <h2 className="font-display font-stretch-condensed text-xl font-black tracking-tight text-gold uppercase italic">
              Conectar a sessão do Mercado Livre
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ash">
              O hub de afiliados não tem API pública, então o painel reusa a sua sessão do
              navegador. Ela costuma durar algumas horas.
            </p>

            {/* A real sequence, so it is numbered. */}
            <ol className="mt-5 max-w-2xl space-y-3 text-sm text-paper/80">
              {[
                <>
                  Abra{" "}
                  <a
                    href="https://www.mercadolivre.com.br/afiliados/hub"
                    target="_blank"
                    rel="noreferrer"
                    className="text-gold underline decoration-gold/40 underline-offset-4 hover:decoration-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                  >
                    mercadolivre.com.br/afiliados/hub
                  </a>{" "}
                  logado na sua conta.
                </>,
                <>
                  No DevTools (F12), vá para a aba <strong className="font-semibold text-paper">Network</strong> e
                  faça uma busca qualquer no hub.
                </>,
                <>
                  Clique com o botão direito na requisição{" "}
                  <code className="font-mono text-gold">hub/search</code>, escolha{" "}
                  <strong className="font-semibold text-paper">Copy → Copy as cURL</strong>.
                </>,
                <>
                  Cole o curl inteiro no campo abaixo — o painel extrai o Cookie e o x-csrf-token
                  sozinho.
                </>,
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
                  Curl da requisição hub/search
                </span>
                <textarea
                  required
                  value={curlCommand}
                  onChange={(event) => setCurlCommand(event.target.value)}
                  placeholder="curl --url 'https://www.mercadolivre.com.br/affiliate-program/api/hub/search…"
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
            <form
              onSubmit={handleSearch}
              className="flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <label htmlFor="ml-query" className="sr-only">
                O que você procura
              </label>
              <input
                id="ml-query"
                required
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="fone bluetooth, air fryer, cadeira gamer…"
                className="min-w-0 flex-1 rounded-full border border-ink-line bg-ink-raised px-5 py-3 text-sm text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={searching}
                className="rounded-full bg-gold px-7 py-3 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {searching ? "Buscando…" : "Listar produtos"}
              </button>
              {!showSessionForm && (
                <button
                  type="button"
                  onClick={() => setShowSessionForm(true)}
                  className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none sm:ml-1"
                >
                  Trocar sessão
                </button>
              )}
            </form>

            <p aria-live="polite" className="sr-only">
              {searching ? "Buscando produtos" : `${items.length} produtos listados`}
            </p>

            {searchError && (
              <p
                role="alert"
                className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
              >
                {searchError}
              </p>
            )}

            {items.length > 0 && (
              <p className="mt-8 font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
                {items.length} produto{items.length === 1 ? "" : "s"} · comissão em destaque
              </p>
            )}

            {searched && items.length === 0 && !searching && !searchError && (
              <p className="mt-10 text-sm text-ash">
                Nada encontrado para essa busca. Tente outro termo.
              </p>
            )}

            {!searched && !searchError && (
              <p className="mt-10 max-w-md text-sm text-ash">
                Busque um termo para ver os produtos do hub com preço, desconto e comissão — e
                gere o link de afiliado direto daqui.
              </p>
            )}

            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, index) => {
                const generatedLink = generatedLinks[item.itemId];
                const isGenerating = generatingItemId === item.itemId;

                return (
                  <article
                    key={item.itemId}
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
                      {item.commissionLabel && (
                        <div className="absolute top-3 right-0">
                          <CommissionTag label={item.commissionLabel} />
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

                      {(item.rating !== null || item.soldLabel) && (
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ash">
                          {item.rating !== null && (
                            <span className="text-ink/70">
                              <span aria-hidden="true" className="text-gold-deep">
                                ★
                              </span>{" "}
                              {item.rating}
                            </span>
                          )}
                          {item.soldLabel && <span>{item.soldLabel}</span>}
                        </p>
                      )}

                      <div className="mt-auto pt-1">
                        {generatedLink ? (
                          <div className="rounded-xl border border-ink/15 bg-ink/[0.04] p-2">
                            <div className="flex items-center gap-2">
                              <input
                                readOnly
                                aria-label={`Link de afiliado de ${item.title}`}
                                value={generatedLink}
                                onFocus={(event) => event.currentTarget.select()}
                                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink focus-visible:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleCopy(item.itemId, generatedLink)}
                                className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                              >
                                {copiedItemId === item.itemId ? "Copiado" : "Copiar"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleGenerateLink(item)}
                            disabled={isGenerating}
                            className="w-full rounded-full bg-ink px-4 py-2.5 font-display font-stretch-condensed text-xs font-black tracking-wide text-gold uppercase italic transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ash disabled:ring-1 disabled:ring-ink/15 disabled:hover:bg-transparent disabled:hover:text-ash"
                          >
                            {isGenerating ? "Gerando…" : "Gerar link"}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {hasMore && (
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
      </main>
    </div>
  );
}
