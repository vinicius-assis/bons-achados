"use client";

import { useMemo, useState } from "react";
import type { Highlight } from "@prisma/client";
import { formatBrazilTime } from "@/lib/date";

type SortOption = "price-desc" | "price-asc" | "platform";

const SORT_LABEL: Record<SortOption, string> = {
  "price-desc": "Preço: maior primeiro",
  "price-asc": "Preço: menor primeiro",
  platform: "Plataforma",
};

// Fixed display order for the "platform" sort — not alphabetical, matches
// how the marketplaces are already ordered elsewhere in the admin UI.
const PLATFORM_ORDER: Record<string, number> = {
  MERCADO_LIVRE: 0,
  AMAZON: 1,
  SHOPEE: 2,
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MARKETPLACE_LABEL: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

const MARKETPLACE_BADGE_STYLE: Record<string, { bg: string; text: string }> = {
  MERCADO_LIVRE: { bg: "bg-[#FFE600]", text: "text-[#2D3277]" },
  AMAZON: { bg: "bg-ink", text: "text-paper" },
  SHOPEE: { bg: "bg-[#EE4D2D]", text: "text-white" },
};

// Colored per marketplace (own palette, not a reproduction of any brand's
// logo) so the pill is scannable at a glance without relying on icons.
function MarketplaceBadge({ marketplace }: { marketplace: string }) {
  const label = MARKETPLACE_LABEL[marketplace] ?? marketplace;
  const style = MARKETPLACE_BADGE_STYLE[marketplace] ?? { bg: "bg-ash/30", text: "text-ink" };

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider uppercase ${style.bg} ${style.text}`}
    >
      {label}
    </span>
  );
}

function sortHighlights(highlights: Highlight[], sortBy: SortOption): Highlight[] {
  const sorted = [...highlights];
  if (sortBy === "price-desc") {
    sorted.sort((a, b) => b.price - a.price);
  } else if (sortBy === "price-asc") {
    sorted.sort((a, b) => a.price - b.price);
  } else {
    sorted.sort(
      (a, b) => (PLATFORM_ORDER[a.marketplace] ?? 99) - (PLATFORM_ORDER[b.marketplace] ?? 99)
    );
  }
  return sorted;
}

export default function VitrineHighlights({ highlights }: { highlights: Highlight[] }) {
  const [sortBy, setSortBy] = useState<SortOption>("price-desc");
  const sortedHighlights = useMemo(() => sortHighlights(highlights, sortBy), [highlights, sortBy]);

  if (highlights.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-ash">
        Ainda não tem destaque hoje. Volta mais tarde.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <label className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.18em] text-ash uppercase">
            Ordenar por
          </span>
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            className="rounded-full border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
          >
            {(Object.keys(SORT_LABEL) as SortOption[]).map((option) => (
              <option key={option} value={option}>
                {SORT_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {sortedHighlights.map((highlight) => (
          <div
            key={highlight.id}
            className="flex flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_10px_24px_-14px_rgba(0,0,0,0.25)] transition hover:shadow-[0_14px_28px_-14px_rgba(0,0,0,0.35)]"
          >
            <div className="bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={highlight.image}
                alt=""
                loading="lazy"
                className="mx-auto h-40 w-full object-contain"
              />
            </div>
            <div className="flex flex-1 flex-col gap-2 border-t border-ink/10 p-4">
              <MarketplaceBadge marketplace={highlight.marketplace} />
              <h2 className="line-clamp-2 text-sm leading-snug font-medium text-ink">
                {highlight.title}
              </h2>
              {highlight.note && (
                <p className="line-clamp-3 text-xs leading-snug text-ink/70">{highlight.note}</p>
              )}
              <div className="mt-auto flex items-end justify-between gap-2">
                <span className="font-mono text-[10px] tracking-wider text-ink/50 uppercase">
                  {formatBrazilTime(highlight.createdAt)}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-stretch-condensed text-xl leading-none font-black tracking-tight text-ink tabular-nums">
                    {formatPrice(highlight.price)}
                  </span>
                  {highlight.oldPrice !== null && (
                    <span className="font-mono text-xs text-ash line-through tabular-nums">
                      {formatPrice(highlight.oldPrice)}
                    </span>
                  )}
                </div>
              </div>
              <a
                href={highlight.affiliateLink}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="group flex items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 font-display font-stretch-condensed text-xs font-black tracking-wide text-ink uppercase italic shadow-[0_6px_14px_-6px_rgba(217,163,17,0.5)] transition hover:bg-gold-deep hover:shadow-[0_8px_18px_-6px_rgba(217,163,17,0.55)] focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
              >
                Ver oferta
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="none"
                  className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5"
                >
                  <path
                    d="M4 10h11.5M11 5.5 16 10l-5 4.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <p className="text-center font-mono text-[10px] tracking-wider text-ink/50 uppercase">
                Link patrocinado
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
