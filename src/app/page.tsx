import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Image from "next/image";
import { listTodaysHighlights } from "@/lib/highlights/store";

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
// (no cookies/headers/searchParams/fetch), so Next.js would otherwise prerender
// it once at build time and freeze the HTML, hiding every future highlight.
export const dynamic = "force-dynamic";

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

export default async function VitrinePage() {
  const highlights = await listTodaysHighlights();

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
        {highlights.length === 0 ? (
          <p className="mt-10 text-center text-sm text-ash">
            Ainda não tem destaque hoje. Volta mais tarde.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {highlights.map((highlight) => (
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
                  <a
                    href={highlight.affiliateLink}
                    target="_blank"
                    rel="noopener noreferrer sponsored"
                    className="group mt-auto flex items-center justify-center gap-2 rounded-xl bg-gold px-4 py-3 font-display font-stretch-condensed text-xs font-black tracking-wide text-ink uppercase italic shadow-[0_6px_14px_-6px_rgba(217,163,17,0.5)] transition hover:bg-gold-deep hover:shadow-[0_8px_18px_-6px_rgba(217,163,17,0.55)] focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
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
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
