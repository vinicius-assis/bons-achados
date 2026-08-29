import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Image from "next/image";
import type { Marketplace } from "@prisma/client";
import { listHighlightsPage } from "@/lib/highlights/store";
import { buildPageWindow } from "@/lib/pagination";
import VitrineHighlights from "./VitrineHighlights";
import FilterForm from "./FilterForm";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Bons Achados",
  description: "As melhores promoções do dia, selecionadas à mão.",
};

// This page reads live data via a direct Prisma call with no request-time API
// (no cookies/headers/fetch), so Next.js would otherwise prerender it once at
// build time and freeze the HTML, hiding every future highlight.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

const PAGER_LINK_CLASS =
  "rounded-full border border-ink/15 px-4 py-2 font-mono text-xs tracking-wider text-ink uppercase transition hover:border-ink focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none";
const PAGER_CURRENT_CLASS =
  "rounded-full border border-ink bg-ink px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase";
const PAGER_ELLIPSIS_CLASS = "px-2 py-2 font-mono text-xs tracking-wider text-ink/40";
const ALL_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];

type SearchParams = { [key: string]: string | string[] | undefined };

function parseMarketplaces(searchParams: SearchParams): Marketplace[] {
  if (searchParams.filtered !== "1") {
    return ALL_MARKETPLACES;
  }
  const raw = searchParams.marketplace;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return ALL_MARKETPLACES.filter((marketplace) => values.includes(marketplace));
}

function buildPageHref(page: number, marketplaces: Marketplace[], q: string, filtered: boolean): string {
  const params = new URLSearchParams();
  if (filtered) {
    params.set("filtered", "1");
    for (const marketplace of marketplaces) {
      params.append("marketplace", marketplace);
    }
  }
  if (q) {
    params.set("q", q);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export default async function VitrinePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const filtered = params.filtered === "1";
  const marketplaces = parseMarketplaces(params);
  const q = typeof params.q === "string" ? params.q : "";
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const page = Number.isFinite(rawPage) && rawPage > 1 ? Math.floor(rawPage) : 1;

  const { items, totalPages } = await listHighlightsPage({ page, pageSize: PAGE_SIZE, marketplaces, q });

  return (
    <div className={`${archivo.variable} flex min-h-screen flex-col bg-paper font-body text-ink`}>
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-5">
          <Image
            src="/bons-achados.png"
            alt=""
            width={40}
            height={40}
            className="shrink-0 rounded-full"
            priority
          />
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-ash uppercase">
              Bons Achados
            </p>
            <p className="font-display font-stretch-condensed text-lg leading-none font-black text-ink uppercase italic">
              Ofertas de hoje
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <FilterForm marketplaces={marketplaces} q={q} />

        <VitrineHighlights highlights={items} />

        {totalPages > 1 && (
          <nav
            aria-label="Paginação da vitrine"
            className="mt-10 flex flex-wrap items-center justify-center gap-2"
          >
            {page > 1 && (
              <>
                <a href={buildPageHref(1, marketplaces, q, filtered)} className={PAGER_LINK_CLASS}>
                  Primeira
                </a>
                <a
                  href={buildPageHref(page - 1, marketplaces, q, filtered)}
                  className={PAGER_LINK_CLASS}
                >
                  ‹ Anterior
                </a>
              </>
            )}

            {buildPageWindow(page, totalPages).map((item, index) =>
              item.type === "ellipsis" ? (
                <span key={`ellipsis-${index}`} aria-hidden="true" className={PAGER_ELLIPSIS_CLASS}>
                  …
                </span>
              ) : item.page === page ? (
                <span key={item.page} aria-current="page" className={PAGER_CURRENT_CLASS}>
                  {item.page}
                </span>
              ) : (
                <a
                  key={item.page}
                  href={buildPageHref(item.page, marketplaces, q, filtered)}
                  className={PAGER_LINK_CLASS}
                >
                  {item.page}
                </a>
              )
            )}

            {page < totalPages && (
              <>
                <a
                  href={buildPageHref(page + 1, marketplaces, q, filtered)}
                  className={PAGER_LINK_CLASS}
                >
                  Próxima ›
                </a>
                <a
                  href={buildPageHref(totalPages, marketplaces, q, filtered)}
                  className={PAGER_LINK_CLASS}
                >
                  Última
                </a>
              </>
            )}
          </nav>
        )}
      </main>

      <footer className="border-t border-ink/10">
        <div className="mx-auto max-w-5xl px-6 py-6">
          <p className="text-xs text-ink/60">
            Como associado da Amazon, eu recebo por compras qualificadas.
          </p>
        </div>
      </footer>
    </div>
  );
}
