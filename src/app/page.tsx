import { Suspense } from "react";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Image from "next/image";
import type { Marketplace } from "@prisma/client";
import FilterForm from "./FilterForm";
import VitrineResults from "./VitrineResults";
import VitrineResultsSkeleton from "./VitrineResultsSkeleton";

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

  // Re-suspends (showing the skeleton) whenever a search / page / filter change
  // navigates here, since the key changes and React remounts the boundary.
  const resultsKey = `${filtered ? 1 : 0}|${q}|${marketplaces.join(",")}|${page}`;

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

        <Suspense key={resultsKey} fallback={<VitrineResultsSkeleton />}>
          <VitrineResults page={page} marketplaces={marketplaces} q={q} filtered={filtered} />
        </Suspense>
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
