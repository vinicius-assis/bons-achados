"use client";

import { buildPageWindow } from "@/lib/pagination";

const LINK_CLASS =
  "rounded-full border border-ink-line bg-ink-raised px-4 py-2 font-mono text-xs tracking-wider text-paper uppercase transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-ink-line disabled:hover:text-paper";
const CURRENT_CLASS =
  "rounded-full bg-gold px-4 py-2 font-mono text-xs tracking-wider text-ink uppercase";
const ELLIPSIS_CLASS = "px-2 py-2 font-mono text-xs tracking-wider text-ash";

type HubPagerProps = {
  currentPage: number;
  /** Exact mode: totalPages. Windowed mode: the highest page fetched so far. */
  lastKnownPage: number;
  /** Exact mode: currentPage < totalPages. Windowed mode: the upstream "has more" signal. */
  hasNext: boolean;
  /** true → show "Primeira"/"Última" (we know where the list ends). */
  exact: boolean;
  disabled: boolean;
  onPageChange: (page: number) => void;
};

export default function HubPager({
  currentPage,
  lastKnownPage,
  hasNext,
  exact,
  disabled,
  onPageChange,
}: HubPagerProps) {
  // Nothing to navigate: a single page with no next.
  if (lastKnownPage <= 1 && currentPage <= 1 && !hasNext) {
    return null;
  }

  const go = (page: number) => {
    if (disabled || page === currentPage || page < 1) return;
    if (!hasNext && page > lastKnownPage) return;
    onPageChange(page);
  };

  return (
    <nav
      aria-label="Paginação"
      className="mt-10 flex flex-wrap items-center justify-center gap-2"
    >
      {exact && currentPage > 1 && (
        <button type="button" disabled={disabled} onClick={() => go(1)} className={LINK_CLASS}>
          Primeira
        </button>
      )}
      {currentPage > 1 && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => go(currentPage - 1)}
          className={LINK_CLASS}
        >
          ‹ Anterior
        </button>
      )}

      {buildPageWindow(currentPage, Math.max(lastKnownPage, currentPage)).map((item, index) =>
        item.type === "ellipsis" ? (
          <span key={`ellipsis-${index}`} aria-hidden="true" className={ELLIPSIS_CLASS}>
            …
          </span>
        ) : item.page === currentPage ? (
          <span key={item.page} aria-current="page" className={CURRENT_CLASS}>
            {item.page}
          </span>
        ) : (
          <button
            type="button"
            key={item.page}
            disabled={disabled}
            onClick={() => go(item.page)}
            className={LINK_CLASS}
          >
            {item.page}
          </button>
        )
      )}

      {hasNext && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => go(currentPage + 1)}
          className={LINK_CLASS}
        >
          Próxima ›
        </button>
      )}
      {exact && hasNext && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => go(lastKnownPage)}
          className={LINK_CLASS}
        >
          Última
        </button>
      )}
    </nav>
  );
}
