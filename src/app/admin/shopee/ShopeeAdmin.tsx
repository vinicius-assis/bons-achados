"use client";

import { useCallback, useState } from "react";
import { isValidNote } from "@/lib/highlights/note";
import { NOTE_TEMPLATES } from "@/lib/highlights/noteTemplates";

type ShopeeHubItem = {
  itemId: string;
  title: string;
  price: number;
  discount: number | null;
  image: string;
  affiliateLink: string;
  productLink: string;
  shopName: string;
  commissionRate: string | null;
  ratingStar: number | null;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCommission(rate: string | null): string | null {
  if (!rate) {
    return null;
  }
  const value = Number(rate);
  if (Number.isNaN(value)) {
    return null;
  }
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

/**
 * The commission chip is drawn as the price tag from the logo mark: a notched
 * point on the left, a punched hole, slapped on at a slight angle. Same shape
 * as the Mercado Livre hub's tag, reused here for visual consistency between
 * hubs.
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

export default function ShopeeAdmin() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ShopeeHubItem[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [selectingItemId, setSelectingItemId] = useState<string | null>(null);
  const [selectedForPost, setSelectedForPost] = useState<Record<string, boolean>>({});
  const [highlightingItemId, setHighlightingItemId] = useState<string | null>(null);
  const [highlightedItems, setHighlightedItems] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const fetchPage = useCallback(async (keyword: string, targetPage: number) => {
    const response = await fetch(
      `/api/admin/shopee/search?q=${encodeURIComponent(keyword)}&page=${targetPage}`
    );
    const body = await response.json();
    if (!response.ok) {
      throw new Error("search_failed");
    }
    return { items: body.items as ShopeeHubItem[], hasNextPage: Boolean(body.hasNextPage) };
  }, []);

  const loadPage = useCallback(
    async (targetPage: number, mode: "replace" | "append") => {
      const setLoadingState = mode === "replace" ? setSearching : setLoadingMore;
      setLoadingState(true);
      setSearchError(null);
      try {
        const result = await fetchPage(query, targetPage);
        setItems((previous) => (mode === "replace" ? result.items : [...previous, ...result.items]));
        setHasMore(result.hasNextPage);
        setPage(targetPage);
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
    [fetchPage, query]
  );

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();
    await loadPage(1, "replace");
  }

  async function handleLoadMore() {
    await loadPage(page + 1, "append");
  }

  async function handleSelectForPost(item: ShopeeHubItem) {
    setSelectingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          source: "AUTO",
          title: item.title,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          discount: item.discount,
          category: null,
        }),
      });
      if (response.status === 409) {
        setSelectedForPost((previous) => ({ ...previous, [item.itemId]: true }));
        return;
      }
      if (!response.ok) {
        setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
        return;
      }
      setSelectedForPost((previous) => ({ ...previous, [item.itemId]: true }));
    } catch {
      setSearchError(`Não deu para selecionar "${item.title}" para postar. Tente de novo.`);
    } finally {
      setSelectingItemId(null);
    }
  }

  async function handleHighlight(item: ShopeeHubItem, note: string) {
    setHighlightingItemId(item.itemId);
    setSearchError(null);
    try {
      const response = await fetch("/api/admin/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          title: item.title,
          note,
          affiliateLink: item.affiliateLink,
          image: item.image,
          price: item.price,
          oldPrice: null,
          discount: item.discount,
        }),
      });
      if (!response.ok) {
        setSearchError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
        return;
      }
      setHighlightedItems((previous) => ({ ...previous, [item.itemId]: true }));
    } catch {
      setSearchError(`Não deu para destacar "${item.title}" na vitrine. Tente de novo.`);
    } finally {
      setHighlightingItemId(null);
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

  return (
    <div>
      <div>
        <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Shopee</p>
        <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
          Hub de <span className="text-gold">afiliados</span>
        </h1>
      </div>

      <div className="mt-8">
        <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label htmlFor="shopee-query" className="sr-only">
            O que você procura
          </label>
          <input
            id="shopee-query"
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
            {searching ? "Buscando…" : "Buscar produtos"}
          </button>
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
          <p className="mt-10 text-sm text-ash">Nada encontrado para essa busca. Tente outro termo.</p>
        )}

        {!searched && !searching && !searchError && (
          <p className="mt-10 max-w-md text-sm text-ash">
            Busque um termo para ver os produtos da Shopee com preço, desconto e comissão — o link
            de afiliado já vem pronto.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const commissionLabel = formatCommission(item.commissionRate);

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
                  {commissionLabel && (
                    <div className="absolute top-3 right-0">
                      <CommissionTag label={commissionLabel} />
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

                  <span className="font-display font-stretch-condensed text-2xl leading-none font-black tracking-tight text-ink tabular-nums">
                    {formatPrice(item.price)}
                  </span>

                  {(item.ratingStar !== null || item.shopName) && (
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ash">
                      {item.ratingStar !== null && (
                        <span className="text-ink/70">
                          <span aria-hidden="true" className="text-gold-deep">
                            ★
                          </span>{" "}
                          {item.ratingStar}
                        </span>
                      )}
                      {item.shopName && <span>{item.shopName}</span>}
                    </p>
                  )}

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
                          onClick={() => handleCopy(item.itemId, item.affiliateLink)}
                          className="shrink-0 rounded-full bg-ink px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                        >
                          {copiedItemId === item.itemId ? "Copiado" : "Copiar"}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectForPost(item)}
                      disabled={selectingItemId === item.itemId || selectedForPost[item.itemId]}
                      className="mt-2 w-full rounded-full border border-gold/40 px-4 py-2 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-gold hover:text-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {selectedForPost[item.itemId]
                        ? "Selecionado ✓"
                        : selectingItemId === item.itemId
                          ? "Selecionando…"
                          : "Selecionar para postar"}
                    </button>
                    {!highlightedItems[item.itemId] && (
                      <>
                        <select
                          value=""
                          onChange={(event) => {
                            const template = event.target.value;
                            if (!template) {
                              return;
                            }
                            setNoteDrafts((previous) => ({ ...previous, [item.itemId]: template }));
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
                          value={noteDrafts[item.itemId] ?? ""}
                          onChange={(event) =>
                            setNoteDrafts((previous) => ({
                              ...previous,
                              [item.itemId]: event.target.value,
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
                      onClick={() =>
                        handleHighlight(item, (noteDrafts[item.itemId] ?? "").trim())
                      }
                      disabled={
                        highlightingItemId === item.itemId ||
                        highlightedItems[item.itemId] ||
                        !isValidNote(noteDrafts[item.itemId] ?? "")
                      }
                      className="mt-2 w-full rounded-full border border-ink/15 bg-ink/[0.04] px-4 py-2 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-ink hover:text-gold focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {highlightedItems[item.itemId]
                        ? "Na vitrine ✓"
                        : highlightingItemId === item.itemId
                          ? "Destacando…"
                          : "Destacar na vitrine"}
                    </button>
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
      </div>
    </div>
  );
}
