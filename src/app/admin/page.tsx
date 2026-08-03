import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Painel · Bons Achados",
  description: "Visão geral da operação de coleta e curadoria de ofertas.",
};

const STATS = [
  { label: "coletados hoje", value: 128 },
  { label: "aprovados", value: 42 },
  { label: "pendentes de revisão", value: 91 },
  { label: "score médio", value: 78 },
];

const MARKETPLACES = [
  { name: "Mercado Livre", source: "automático", count: 80 },
  { name: "Amazon", source: "manual", count: 12 },
  { name: "Shopee", source: "manual", count: 8 },
];

const MAX_MARKETPLACE_COUNT = Math.max(...MARKETPLACES.map((m) => m.count));

const RECENT_FINDS = [
  { time: "14:32", title: "Fone bluetooth JBL Tune 510BT", marketplace: "Mercado Livre", score: 91 },
  { time: "14:20", title: "Air fryer Mondial 5L", marketplace: "Mercado Livre", score: 84 },
  { time: "13:58", title: "Cadeira gamer reclinável", marketplace: "Amazon", score: 76 },
  { time: "13:41", title: "Cápsula de café compatível Nespresso", marketplace: "Mercado Livre", score: 88 },
  { time: "13:15", title: "Mochila notebook antifurto", marketplace: "Shopee", score: 71 },
];

export default function AdminDashboardPage() {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
            Visão geral
          </p>
          <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
            Painel de <span className="text-gold">operação</span>
          </h1>
        </div>
        <p className="max-w-sm text-right font-mono text-[11px] text-ash">
          dados de exemplo — a coleta automática ainda não está rodando, é assim que o painel
          fica com o pipeline ativo
        </p>
      </div>

      <div className="mt-8 grid grid-cols-2 divide-y divide-ink-line rounded-2xl border border-ink-line bg-ink-raised sm:grid-cols-4 sm:divide-y-0 sm:divide-x">
        {STATS.map((stat, index) => (
          <div
            key={stat.label}
            style={{ animationDelay: `${index * 60}ms` }}
            className="animate-sticker-in px-6 py-6 text-center sm:text-left"
          >
            <p className="font-mono text-4xl leading-none font-bold tracking-tight text-gold tabular-nums">
              {stat.value}
            </p>
            <p className="mt-2 font-mono text-[11px] tracking-wider text-ash uppercase">
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="rounded-2xl border border-ink-line bg-ink-raised p-6 lg:col-span-2">
          <h2 className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic">
            Por marketplace
          </h2>
          <ul className="mt-5 space-y-4">
            {MARKETPLACES.map((marketplace) => (
              <li key={marketplace.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-paper">
                    {marketplace.name}{" "}
                    <span className="font-mono text-[10px] tracking-wider text-ash uppercase">
                      · {marketplace.source}
                    </span>
                  </span>
                  <span className="font-mono text-sm text-gold tabular-nums">
                    {marketplace.count}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-ink">
                  <div
                    className="h-full rounded-full bg-gold"
                    style={{ width: `${(marketplace.count / MAX_MARKETPLACE_COUNT) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-ink-line bg-ink-raised p-6 lg:col-span-3">
          <h2 className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic">
            Últimos achados
          </h2>
          <ul className="mt-4 divide-y divide-ink-line">
            {RECENT_FINDS.map((find) => (
              <li key={find.time + find.title} className="flex items-center gap-4 py-3">
                <span className="shrink-0 font-mono text-xs text-ash tabular-nums">
                  {find.time}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-paper">{find.title}</p>
                  <p className="font-mono text-[10px] tracking-wider text-ash uppercase">
                    {find.marketplace}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-gold/40 px-2.5 py-1 font-mono text-xs text-gold tabular-nums">
                  {find.score}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3 sm:justify-start">
        <Link
          href="/admin/mercadolivre"
          className="rounded-full bg-gold px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
        >
          Ir para o Hub Mercado Livre →
        </Link>
        <Link
          href="/admin/postar"
          className="rounded-full border border-ink-line bg-ink-raised px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
        >
          Produtos para postar →
        </Link>
      </div>
    </div>
  );
}
