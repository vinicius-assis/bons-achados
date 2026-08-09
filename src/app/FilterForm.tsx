"use client";

import type { Marketplace } from "@prisma/client";

const ALL_MARKETPLACES: Marketplace[] = ["MERCADO_LIVRE", "AMAZON", "SHOPEE"];
const MARKETPLACE_LABEL: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

export default function FilterForm({
  marketplaces,
  q,
}: {
  marketplaces: Marketplace[];
  q: string;
}) {
  return (
    <form method="get" className="mb-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-3">
      <input type="hidden" name="filtered" value="1" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {ALL_MARKETPLACES.map((marketplace) => (
          <label key={marketplace} className="flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              name="marketplace"
              value={marketplace}
              defaultChecked={marketplaces.includes(marketplace)}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="size-4 rounded border-ink/30 text-ink focus-visible:ring-2 focus-visible:ring-ink/40"
            />
            {MARKETPLACE_LABEL[marketplace]}
          </label>
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:flex-1">
        <label htmlFor="vitrine-q" className="sr-only">
          Buscar por nome
        </label>
        <input
          id="vitrine-q"
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nome…"
          className="min-w-0 flex-1 rounded-full border border-ink/15 bg-white px-4 py-2 text-sm text-ink placeholder:text-ink/40 focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none"
        />
        <button
          type="submit"
          className="rounded-full bg-ink px-5 py-2 font-display font-stretch-condensed text-xs font-black tracking-wide text-gold uppercase italic transition hover:bg-ink-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          Filtrar
        </button>
      </div>
    </form>
  );
}
