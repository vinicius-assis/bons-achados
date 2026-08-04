"use client";

import { useCallback, useEffect, useState } from "react";

type HighlightItem = {
  id: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  marketplace: string;
};

function formatPrice(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function VitrineAdmin() {
  const [items, setItems] = useState<HighlightItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/highlights");
      if (!response.ok) {
        throw new Error("load_failed");
      }
      const body = await response.json();
      setItems(body.items);
    } catch {
      setError("Não deu para carregar os destaques. Tente de novo em alguns segundos.");
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

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/highlights/${id}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error("remove_failed");
      }
      setItems((previous) => previous.filter((item) => item.id !== id));
    } catch {
      setError("Não deu para remover o destaque. Tente de novo.");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-ash">Carregando os destaques de hoje…</p>;
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper">
          {error}
        </p>
      )}

      <p className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
        {items.length} destaque{items.length === 1 ? "" : "s"} hoje
      </p>

      {items.length === 0 && (
        <p className="mt-10 max-w-md text-sm text-ash">
          Nenhum destaque ainda. Use o botão &quot;Destacar na vitrine&quot; no Hub Mercado
          Livre, no cadastro manual ou na fila de postar.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="overflow-hidden rounded-2xl border border-ink-line bg-ink-raised p-4">
            <h2 className="line-clamp-2 text-sm leading-snug text-paper">{item.title}</h2>
            <p className="mt-1 font-mono text-xs text-gold tabular-nums">
              {formatPrice(item.price)}
              {item.discount ? ` · ${item.discount}% OFF` : ""}
            </p>
            <button
              type="button"
              onClick={() => handleRemove(item.id)}
              disabled={removingId === item.id}
              className="mt-3 w-full rounded-full border border-alert/40 px-4 py-2 font-mono text-[10px] tracking-wider text-alert uppercase transition hover:bg-alert hover:text-paper focus-visible:ring-2 focus-visible:ring-alert focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {removingId === item.id ? "Removendo…" : "Remover destaque"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
