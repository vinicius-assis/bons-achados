"use client";

import { useCallback, useEffect, useState } from "react";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import { copyToClipboard } from "@/lib/clipboard";

type PostDraftItem = {
  id: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  discount: number | null;
  marketplace: string;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function shuffleByMarketplace(items: PostDraftItem[]): PostDraftItem[] {
  const groups = new Map<string, PostDraftItem[]>();
  for (const item of items) {
    const group = groups.get(item.marketplace);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.marketplace, [item]);
    }
  }

  for (const group of groups.values()) {
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
  }

  const queues = Array.from(groups.values());
  const result: PostDraftItem[] = [];
  let remaining = queues.length;
  let index = 0;
  while (remaining > 0) {
    const queue = queues[index % queues.length];
    if (queue.length > 0) {
      result.push(queue.shift() as PostDraftItem);
      if (queue.length === 0) {
        remaining -= 1;
      }
    }
    index += 1;
  }
  return result;
}

export default function PostarQueue() {
  const [items, setItems] = useState<PostDraftItem[]>([]);
  const [caption, setCaption] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/postdraft");
      if (!response.ok) {
        throw new Error("load_failed");
      }
      const body = await response.json();
      setItems(body.items);
      setCaption(body.caption);
    } catch {
      setError("Não deu para carregar a fila. Tente de novo em alguns segundos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the state updates inside load happen
    // outside the effect's synchronous body, not as its direct side effect.
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function handleClear() {
    setClearing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/postdraft/clear", { method: "POST" });
      if (!response.ok) {
        throw new Error("clear_failed");
      }
      await load();
    } catch {
      setError("Não deu para limpar a lista. Tente de novo.");
    } finally {
      setClearing(false);
    }
  }

  function handleShuffle() {
    setItems((current) => shuffleByMarketplace(current));
  }

  async function handleRemoveItem(itemId: string) {
    setRemovingItemId(itemId);
    setError(null);
    try {
      const response = await fetch(`/api/admin/postdraft/${itemId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("remove_failed");
      }
      setItems((current) => current.filter((item) => item.id !== itemId));
    } catch {
      setError("Não deu para remover o item. Tente de novo.");
    } finally {
      setRemovingItemId(null);
    }
  }

  async function handleCopyCaption() {
    const succeeded = await copyToClipboard(caption);
    if (!succeeded) {
      setError("O navegador bloqueou a cópia. Selecione o texto e copie na mão.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyLink(itemId: string, link: string) {
    const succeeded = await copyToClipboard(link);
    if (!succeeded) {
      setError("O navegador bloqueou a cópia. Selecione o link e copie na mão.");
      return;
    }
    setCopiedItemId(itemId);
    window.setTimeout(() => setCopiedItemId(null), 2000);
  }

  if (loading) {
    return <p className="text-sm text-ash">Carregando a fila…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
          {items.length} produto{items.length === 1 ? "" : "s"} na fila
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleShuffle}
            disabled={items.length === 0}
            className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Embaralhar
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={clearing || items.length === 0}
            className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-alert hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {clearing ? "Limpando…" : "Limpar lista"}
          </button>
        </div>
      </div>

      {items.length === 0 && (
        <p className="mt-10 max-w-md text-sm text-ash">
          Nada na fila agora. Cadastre um produto manual ou selecione itens no hub do
          Mercado Livre pra começar.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-2xl border border-ink-line bg-ink-raised p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="line-clamp-2 text-sm leading-snug text-paper">{item.title}</h2>
              <button
                type="button"
                onClick={() => handleRemoveItem(item.id)}
                disabled={removingItemId === item.id}
                aria-label={`Remover ${item.title} da fila`}
                className="shrink-0 rounded-full bg-ink px-2.5 py-1 font-mono text-[10px] tracking-wider text-ash uppercase transition hover:bg-alert/10 hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {removingItemId === item.id ? "…" : "×"}
              </button>
            </div>
            <p className="mt-1 font-mono text-xs text-gold tabular-nums">
              {formatPrice(item.price)}
              {item.discount ? ` · ${item.discount}% OFF` : ""}
            </p>
            <div className="mt-2 rounded-xl border border-ink-line bg-ink p-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  aria-label={`Link de afiliado de ${item.title}`}
                  value={item.affiliateLink}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-paper focus-visible:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopyLink(item.id, item.affiliateLink)}
                  className="shrink-0 rounded-full bg-ink-raised px-3 py-1.5 font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  {copiedItemId === item.id ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/postdraft/${item.id}/story`}
                alt=""
                loading="lazy"
                className="aspect-[9/16] w-full rounded-lg object-cover"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/admin/postdraft/${item.id}/feed`}
                alt=""
                loading="lazy"
                className="aspect-[4/5] w-full rounded-lg object-cover"
              />
            </div>
            <div className="mt-3 flex gap-2">
              <a
                href={`/api/admin/postdraft/${item.id}/story`}
                download={`story-${item.id}.jpg`}
                className="flex-1 rounded-full bg-ink px-3 py-2 text-center font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised"
              >
                Baixar story
              </a>
              <a
                href={`/api/admin/postdraft/${item.id}/feed`}
                download={`feed-${item.id}.jpg`}
                className="flex-1 rounded-full bg-ink px-3 py-2 text-center font-mono text-[10px] tracking-wider text-gold uppercase transition hover:bg-ink-raised"
              >
                Baixar feed
              </a>
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className="mt-8 rounded-2xl border border-ink-line bg-ink-raised p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic">
              Legenda do carrossel
            </h2>
            <button
              type="button"
              onClick={handleCopyCaption}
              className="rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-paper"
            >
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
          <textarea
            readOnly
            value={caption}
            rows={10}
            className="mt-4 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
        </div>
      )}

      <ScrollToTopButton />
    </div>
  );
}
