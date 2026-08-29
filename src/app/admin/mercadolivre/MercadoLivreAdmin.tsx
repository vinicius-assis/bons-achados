"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostTitleModal from "@/app/admin/PostTitleModal";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import HighlightCardSkeleton from "@/components/HighlightCardSkeleton";
import { ML_HUB_CATEGORIES } from "@/lib/mercadolivre/categories";
import { copyToClipboard } from "@/lib/clipboard";

type SortOption = "relevance" | "lowest_price" | "highest_price";
type FilterMode = "none" | "extra_commission" | "best_seller";

type PoolItem = {
  id: string;
  productId: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Mercado Livre's hub doesn't return a total count or a "has more" flag —
// a page shorter than this is treated as the last one.
const PAGE_SIZE = 18;

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
  const [sort, setSort] = useState<SortOption>("relevance");
  const [categoryId, setCategoryId] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("none");
  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [liveOffset, setLiveOffset] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<PoolItem | null>(null);

  useEffect(() => {
    fetch("/api/admin/mercadolivre/session")
      .then((response) => response.json())
      .then((body) => setHasSession(Boolean(body.hasSession)))
      .catch(() => setHasSession(false));
  }, []);

  const expireSession = useCallback(() => {
    setHasSession(false);
    setShowSessionForm(true);
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
    } catch {
      setSessionError("Não deu para salvar a sessão. Verifique a conexão e tente de novo.");
    } finally {
      setSavingSession(false);
    }
  }

  // Loads the pool already collected for this marketplace — a database
  // read, no live ML request, so it doesn't depend on hasSession.
  const loadPool = useCallback(() => {
    return fetch("/api/admin/highlights?marketplace=MERCADO_LIVRE")
      .then((response) => response.json())
      .then((body) => setItems(body.items ?? []))
      .catch(() => setSearchError("Não deu para carregar os produtos já coletados."));
  }, []);

  useEffect(() => {
    loadPool().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSearchPage = useCallback(
    async (term: string, offset: number, mode: "replace" | "append") => {
      const setLoadingState = mode === "replace" ? setSearching : setLoadingMore;
      setLoadingState(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ q: term, offset: String(offset), sort });
        if (categoryId) {
          const category = ML_HUB_CATEGORIES.find((candidate) => candidate.id === categoryId);
          if (category) {
            params.set("categoryId", category.id);
            params.set("categoryName", category.name);
          }
        }
        if (filterMode === "extra_commission") {
          params.set("extraCommission", "true");
        } else if (filterMode === "best_seller") {
          params.set("bestSeller", "true");
        }
        const response = await fetch(`/api/admin/mercadolivre/search?${params.toString()}`);
        if (response.status === 401) {
          expireSession();
          return;
        }
        const body = await response.json();
        if (!response.ok) {
          throw new Error("search_failed");
        }
        const fetchedItems = body.items as PoolItem[];
        setItems((previous) => {
          if (mode === "replace") {
            return fetchedItems;
          }
          const seenIds = new Set(previous.map((item) => item.id));
          return [...previous, ...fetchedItems.filter((item) => !seenIds.has(item.id))];
        });
        setHasMore(body.fetchedCount >= PAGE_SIZE);
        setLiveOffset(offset + body.fetchedCount);
        setLastQuery(term);
        setSearched(true);
      } catch {
        setSearchError(
          mode === "replace"
            ? "A busca falhou. Tente de novo em alguns segundos."
            : "Não deu para carregar mais produtos. Tente de novo em alguns segundos."
        );
      } finally {
        setLoadingState(false);
      }
    },
    [expireSession, sort, categoryId, filterMode]
  );

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await fetchSearchPage(query, 0, "replace");
  }

  async function handleLoadMore() {
    await fetchSearchPage(lastQuery, liveOffset, "append");
  }

  const otherFiltersActive = sort !== "relevance" || categoryId !== "" || filterMode !== "none";

  // Clears just the query text (the "x" inside the search field), leaving every
  // other filter as-is.
  async function handleClearQuery() {
    setQuery("");
    if (otherFiltersActive) {
      // Another param still drives the search, so re-run it with a blank query.
      await fetchSearchPage("", 0, "replace");
      return;
    }
    setSearched(false);
    setSearchError(null);
    await loadPool();
  }

  async function handleClearFilters() {
    setQuery("");
    setSort("relevance");
    setCategoryId("");
    setFilterMode("none");
    setSearched(false);
    setSearchError(null);
    await loadPool();
  }

  // Changing a filter re-runs the search after a short debounce, skipping
  // the initial mount so opening the page doesn't replace the saved pool.
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    // With nothing left to search on, an auto-triggered search would just wipe
    // the pool — let "Limpar filtros" fall back to the DB pool instead.
    if (query.trim().length === 0 && categoryId === "" && filterMode === "none") {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void fetchSearchPage(query, 0, "replace");
    }, 400);
    return () => window.clearTimeout(timeoutId);
    // Only filter changes should retrigger this, not `query` or `fetchSearchPage`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, categoryId, filterMode]);

  const filtersActive = query !== "" || otherFiltersActive;

  async function handleSelectForPost(item: PoolItem, imageTitle: string) {
    setSelectingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "MERCADO_LIVRE",
          source: "AUTO",
          title: item.title,
          imageTitle,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          discount: item.discount,
          category: null,
        }),
      });
      if (response.status === 409) {
        setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
        return;
      }
      if (!response.ok) {
        setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.id]: true }));
    } catch {
      setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingId(null);
    }
  }

  async function handleRemove(item: PoolItem) {
    setRemovingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch(`/api/admin/highlights/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("remove_failed");
      }
      setItems((previous) => previous.filter((existing) => existing.id !== item.id));
    } catch {
      setSearchError(`Não deu para remover "${item.title}" da vitrine. Tente de novo.`);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleCopy(id: string, link: string) {
    const succeeded = await copyToClipboard(link);
    if (!succeeded) {
      setSearchError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  }

  const sessionFormVisible = hasSession === false || showSessionForm;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
            Mercado Livre
          </p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Hub de <span className="text-gold">afiliados</span>
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
        {sessionFormVisible && (
          <section className="mb-10 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <h2 className="font-display font-stretch-condensed text-xl font-black tracking-tight text-gold uppercase italic">
              Conectar a sessão do Mercado Livre
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ash">
              A busca manual e a coleta automática reusam a sua sessão do navegador. Ela costuma
              durar algumas horas.
            </p>

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
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="ml-query" className="sr-only">
              O que você procura
            </label>
            <div className="relative min-w-0 flex-1">
              <input
                id="ml-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="fone bluetooth, air fryer, cadeira gamer… (opcional — busca alimenta a vitrine na hora)"
                className="w-full rounded-full border border-ink-line bg-ink-raised px-5 py-3 pr-11 text-sm text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={handleClearQuery}
                  aria-label="Limpar busca"
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-ash transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={searching}
              className="rounded-full bg-gold px-7 py-3 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searching ? "Buscando…" : "Buscar produtos"}
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
        )}

        {hasSession && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="sr-only" htmlFor="ml-sort">
              Ordenar por
            </label>
            <select
              id="ml-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortOption)}
              className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
            >
              <option value="relevance">Mais relevantes</option>
              <option value="lowest_price">Menor preço</option>
              <option value="highest_price">Maior preço</option>
            </select>

            <label className="sr-only" htmlFor="ml-category">
              Categoria
            </label>
            <select
              id="ml-category"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
              className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
            >
              <option value="">Todas as categorias</option>
              {ML_HUB_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                setFilterMode((previous) => (previous === "extra_commission" ? "none" : "extra_commission"))
              }
              aria-pressed={filterMode === "extra_commission"}
              className={`rounded-full border px-4 py-2 font-mono text-xs tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                filterMode === "extra_commission"
                  ? "border-gold bg-gold text-ink"
                  : "border-ink-line bg-ink-raised text-paper hover:border-gold hover:text-gold"
              }`}
            >
              Ganhos extras
            </button>

            <button
              type="button"
              onClick={() => setFilterMode((previous) => (previous === "best_seller" ? "none" : "best_seller"))}
              aria-pressed={filterMode === "best_seller"}
              className={`rounded-full border px-4 py-2 font-mono text-xs tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
                filterMode === "best_seller"
                  ? "border-gold bg-gold text-ink"
                  : "border-ink-line bg-ink-raised text-paper hover:border-gold hover:text-gold"
              }`}
            >
              Mais vendidos
            </button>

            {filtersActive && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        <p aria-live="polite" className="mt-6 font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
          {loading || searching
            ? "carregando…"
            : items.length > 0
              ? `${items.length} produto${items.length === 1 ? "" : "s"} na vitrine hoje`
              : ""}
        </p>

        {searchError && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper"
          >
            {searchError}
          </p>
        )}

        {!loading && !searching && searched && items.length === 0 && !searchError && (
          <p className="mt-10 text-sm text-ash">Nada encontrado para essa busca. Tente outro termo.</p>
        )}

        {!loading && !searching && !searched && items.length === 0 && !searchError && (
          <p className="mt-10 text-sm text-ash">
            Nenhum produto na vitrine ainda. A coleta automática roda a cada 20 minutos.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {loading || searching ? (
            Array.from({ length: 6 }).map((_, index) => <HighlightCardSkeleton key={index} />)
          ) : (
            items.map((item, index) => (
            <article
              key={item.id}
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
                {item.discount !== null && (
                  <span className="absolute bottom-3 left-3 rounded-md bg-ink px-2 py-0.5 font-display font-stretch-condensed text-xs font-black text-gold italic">
                    {item.discount}% off
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
                        onClick={() => handleCopy(item.id, item.affiliateLink)}
                        className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                      >
                        {copiedId === item.id ? "Copiado" : "Copiar"}
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingItem(item)}
                    disabled={selectingId === item.id || selectedForPost[item.id]}
                    className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {selectedForPost[item.id]
                      ? "Selecionado ✓"
                      : selectingId === item.id
                        ? "Selecionando…"
                        : "Selecionar para postar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    disabled={removingId === item.id}
                    className="mt-2 w-full rounded-full border border-alert/40 px-4 py-2 font-mono text-[10px] tracking-wider text-alert uppercase transition hover:bg-alert hover:text-paper focus-visible:ring-2 focus-visible:ring-alert focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removingId === item.id ? "Removendo…" : "Remover da vitrine"}
                  </button>
                </div>
              </div>
            </article>
            ))
          )}
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
      </div>

      {pendingItem && (
        <PostTitleModal
          initialTitle={pendingItem.title}
          submitting={selectingId === pendingItem.id}
          onCancel={() => setPendingItem(null)}
          onConfirm={async (imageTitle) => {
            await handleSelectForPost(pendingItem, imageTitle);
            setPendingItem(null);
          }}
        />
      )}

      <ScrollToTopButton />
    </div>
  );
}
