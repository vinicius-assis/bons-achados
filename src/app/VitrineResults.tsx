import type { Marketplace } from "@prisma/client";
import { listHighlightsPage } from "@/lib/highlights/store";
import { buildPageWindow } from "@/lib/pagination";
import VitrineHighlights from "./VitrineHighlights";

const PAGE_SIZE = 30;

const PAGER_LINK_CLASS =
  "rounded-full border border-ink/15 px-4 py-2 font-mono text-xs tracking-wider text-ink uppercase transition hover:border-ink focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none";
const PAGER_CURRENT_CLASS =
  "rounded-full border border-ink bg-ink px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase";
const PAGER_ELLIPSIS_CLASS = "px-2 py-2 font-mono text-xs tracking-wider text-ink/40";

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

export default async function VitrineResults({
  page,
  marketplaces,
  q,
  filtered,
}: {
  page: number;
  marketplaces: Marketplace[];
  q: string;
  filtered: boolean;
}) {
  const { items, totalPages } = await listHighlightsPage({ page, pageSize: PAGE_SIZE, marketplaces, q });

  return (
    <>
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
    </>
  );
}
