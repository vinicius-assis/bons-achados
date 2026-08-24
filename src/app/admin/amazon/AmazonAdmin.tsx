"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PostTitleModal from "@/app/admin/PostTitleModal";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import { copyToClipboard } from "@/lib/clipboard";

type SortOption = "Relevance" | "Price:LowToHigh" | "Price:HighToLow" | "AvgCustomerReviews" | "NewestArrivals";

const SEARCH_INDEXES = [
  { value: "", label: "Todas as categorias" },
  { value: "Books", label: "Livros" },
  { value: "Computers", label: "Computadores e Informática" },
  { value: "Electronics", label: "Eletrônicos" },
  { value: "HomeAndKitchen", label: "Casa e Cozinha" },
  { value: "KindleStore", label: "Loja Kindle" },
  { value: "MobileApps", label: "Apps e Jogos" },
  { value: "OfficeProducts", label: "Material para Escritório e Papelaria" },
  { value: "ToolsAndHomeImprovement", label: "Ferramentas e Materiais de Construção" },
  { value: "VideoGames", label: "Games" },
];

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

export default function AmazonAdmin() {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("Relevance");
  const [searchIndex, setSearchIndex] = useState("");
  const [brand, setBrand] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [primeOnly, setPrimeOnly] = useState(false);

  const [items, setItems] = useState<PoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<PoolItem | null>(null);

  // Loads the pool already collected for this marketplace — a database
  // read, no live Amazon request.
  const loadPool = useCallback(() => {
    return fetch("/api/admin/highlights?marketplace=AMAZON")
      .then((response) => response.json())
      .then((body) => setItems(body.items ?? []))
      .catch(() => setSearchError("Não deu para carregar as ofertas já coletadas."));
  }, []);

  useEffect(() => {
    loadPool().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = useCallback(async (overrideQuery?: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: overrideQuery ?? query, page: "1" });
      if (searchIndex) params.set("searchIndex", searchIndex);
      if (sortBy !== "Relevance") params.set("sortBy", sortBy);
      if (brand) params.set("brand", brand);
      if (minPrice) params.set("minPrice", String(Math.round(Number(minPrice) * 100)));
      if (maxPrice) params.set("maxPrice", String(Math.round(Number(maxPrice) * 100)));
      if (primeOnly) params.set("prime", "true");

      const response = await fetch(`/api/admin/amazon/search?${params.toString()}`);
      if (response.status === 429) {
        setSearchError("A Amazon limitou as requisições por agora. Tente de novo em alguns segundos.");
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        throw new Error("search_failed");
      }
      setItems(body.items as PoolItem[]);
      setSearched(true);
    } catch {
      setSearchError("A busca falhou. Tente de novo em alguns segundos.");
    } finally {
      setSearching(false);
    }
  }, [query, searchIndex, sortBy, brand, minPrice, maxPrice, primeOnly]);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await runSearch();
  }

  // Clears just the query text (the "x" inside the search field), leaving
  // every other filter as-is.
  async function handleClearQuery() {
    setQuery("");
    if (brand.trim().length > 0) {
      // Another param still satisfies SearchItems' keywords/brand
      // requirement, so re-run the search with the query blanked out.
      await runSearch("");
      return;
    }
    setSearched(false);
    setSearchError(null);
    await loadPool();
  }

  function handleClearFilters() {
    setQuery("");
    setSortBy("Relevance");
    setSearchIndex("");
    setBrand("");
    setMinPrice("");
    setMaxPrice("");
    setPrimeOnly(false);
    setSearched(false);
    setSearchError(null);
    void loadPool();
  }

  // Changing a filter re-runs the search after a short debounce, skipping
  // the initial mount so opening the page doesn't replace the saved pool.
  const filtersMounted = useRef(false);
  useEffect(() => {
    if (!filtersMounted.current) {
      filtersMounted.current = true;
      return;
    }
    // SearchItems requires at least one of keywords/brand (among other
    // alternatives we don't expose) to be non-empty. Without that, an
    // auto-triggered search would carry only sort/category/price/prime
    // params, which the API rejects.
    if (query.trim().length === 0 && brand.trim().length === 0) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      void runSearch();
    }, 400);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, searchIndex, brand, minPrice, maxPrice, primeOnly]);

  const filtersActive =
    query !== "" ||
    sortBy !== "Relevance" ||
    searchIndex !== "" ||
    brand !== "" ||
    minPrice !== "" ||
    maxPrice !== "" ||
    primeOnly;

  async function handleSelectForPost(item: PoolItem, imageTitle: string) {
    setSelectingId(item.id);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "AMAZON",
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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Amazon</p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Hub de <span className="text-gold">afiliados</span>
          </h1>
        </div>
      </div>

      <div className="mt-8">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="amz-query" className="sr-only">
            O que você procura
          </label>
          <div className="relative min-w-0 flex-1">
            <input
              id="amz-query"
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
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="sr-only" htmlFor="amz-sort">
            Ordenar por
          </label>
          <select
            id="amz-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          >
            <option value="Relevance">Mais relevantes</option>
            <option value="Price:LowToHigh">Menor preço</option>
            <option value="Price:HighToLow">Maior preço</option>
            <option value="AvgCustomerReviews">Melhor avaliados</option>
            <option value="NewestArrivals">Mais recentes</option>
          </select>

          <label className="sr-only" htmlFor="amz-category">
            Categoria
          </label>
          <select
            id="amz-category"
            value={searchIndex}
            onChange={(event) => setSearchIndex(event.target.value)}
            className="rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          >
            {SEARCH_INDEXES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label htmlFor="amz-brand" className="sr-only">
            Marca
          </label>
          <input
            id="amz-brand"
            value={brand}
            onChange={(event) => setBrand(event.target.value)}
            placeholder="Marca"
            className="w-32 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <label htmlFor="amz-min-price" className="sr-only">
            Preço mínimo
          </label>
          <input
            id="amz-min-price"
            type="number"
            min="0"
            step="0.01"
            value={minPrice}
            onChange={(event) => setMinPrice(event.target.value)}
            placeholder="Preço mín."
            className="w-28 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <label htmlFor="amz-max-price" className="sr-only">
            Preço máximo
          </label>
          <input
            id="amz-max-price"
            type="number"
            min="0"
            step="0.01"
            value={maxPrice}
            onChange={(event) => setMaxPrice(event.target.value)}
            placeholder="Preço máx."
            className="w-28 rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper placeholder:text-ash/70 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />

          <button
            type="button"
            onClick={() => setPrimeOnly((previous) => !previous)}
            aria-pressed={primeOnly}
            className={`rounded-full border px-4 py-2 font-mono text-xs tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              primeOnly
                ? "border-gold bg-gold text-ink"
                : "border-ink-line bg-ink-raised text-paper hover:border-gold hover:text-gold"
            }`}
          >
            Só Prime
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
          {items.map((item, index) => (
            <article
              key={item.id}
              style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
              className="flex animate-sticker-in flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)]"
            >
              <div className="relative bg-white p-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" loading="lazy" className="mx-auto h-40 w-full object-contain" />
                ) : (
                  <div className="flex h-40 items-center justify-center font-mono text-xs text-ash">sem imagem</div>
                )}
                {item.discount !== null && (
                  <span className="absolute bottom-3 left-3 rounded-md bg-ink px-2 py-0.5 font-display font-stretch-condensed text-xs font-black text-gold italic">
                    {item.discount}% off
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col gap-3 border-t border-ink/10 p-4">
                <h2 className="line-clamp-2 text-sm leading-snug font-medium text-ink">{item.title}</h2>

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
          ))}
        </div>
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
