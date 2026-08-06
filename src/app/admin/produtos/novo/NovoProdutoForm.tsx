"use client";

import { useState } from "react";
import { MIN_NOTE_LENGTH, isValidNote } from "@/lib/highlights/note";

type Row = {
  key: number;
  title: string;
  affiliateLink: string;
  image: string;
  price: string;
  discount: string;
  category: string;
  note: string;
};

type RowStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; category: string } | { kind: "duplicate" } | { kind: "error"; message: string };
type HighlightStatus = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

let nextRowKey = 0;
function emptyRow(): Row {
  nextRowKey += 1;
  return {
    key: nextRowKey,
    title: "",
    affiliateLink: "",
    image: "",
    price: "",
    discount: "",
    category: "",
    note: "",
  };
}

export default function NovoProdutoForm() {
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [statuses, setStatuses] = useState<Record<number, RowStatus>>({});
  const [highlightStatuses, setHighlightStatuses] = useState<Record<number, HighlightStatus>>({});

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((previous) => [...previous, emptyRow()]);
  }

  function removeRow(key: number) {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setStatuses((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setHighlightStatuses((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  async function submitRow(row: Row) {
    const price = Number(row.price.replace(",", "."));
    if (!row.title || !row.affiliateLink || !row.image || !row.price.trim() || Number.isNaN(price)) {
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Preencha nome, link, imagem e preço." } }));
      return;
    }

    setStatuses((previous) => ({ ...previous, [row.key]: { kind: "saving" } }));
    try {
      const response = await fetch("/api/admin/postdraft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          source: "MANUAL",
          title: row.title,
          affiliateLink: row.affiliateLink,
          image: row.image,
          price,
          discount: row.discount ? Number(row.discount) : null,
          category: row.category || null,
        }),
      });

      if (response.status === 409) {
        setStatuses((previous) => ({ ...previous, [row.key]: { kind: "duplicate" } }));
        return;
      }
      if (!response.ok) {
        setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Não deu para cadastrar. Tente de novo." } }));
        return;
      }
      const body = await response.json();
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "saved", category: body.category } }));
    } catch {
      setStatuses((previous) => ({ ...previous, [row.key]: { kind: "error", message: "Não deu para cadastrar. Tente de novo." } }));
    }
  }

  async function highlightRow(row: Row) {
    const price = Number(row.price.replace(",", "."));
    if (!row.title || !row.affiliateLink || !row.image || !row.price.trim() || Number.isNaN(price)) {
      setHighlightStatuses((previous) => ({
        ...previous,
        [row.key]: { kind: "error", message: "Preencha nome, link, imagem e preço." },
      }));
      return;
    }
    if (!isValidNote(row.note)) {
      setHighlightStatuses((previous) => ({
        ...previous,
        [row.key]: {
          kind: "error",
          message: `Escreva uma nota com pelo menos ${MIN_NOTE_LENGTH} caracteres.`,
        },
      }));
      return;
    }

    setHighlightStatuses((previous) => ({ ...previous, [row.key]: { kind: "saving" } }));
    try {
      const response = await fetch("/api/admin/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          marketplace: "SHOPEE",
          title: row.title,
          note: row.note.trim(),
          affiliateLink: row.affiliateLink,
          image: row.image,
          price,
          oldPrice: null,
          discount: row.discount ? Number(row.discount) : null,
        }),
      });
      if (!response.ok) {
        setHighlightStatuses((previous) => ({
          ...previous,
          [row.key]: { kind: "error", message: "Não deu para destacar. Tente de novo." },
        }));
        return;
      }
      setHighlightStatuses((previous) => ({ ...previous, [row.key]: { kind: "saved" } }));
    } catch {
      setHighlightStatuses((previous) => ({
        ...previous,
        [row.key]: { kind: "error", message: "Não deu para destacar. Tente de novo." },
      }));
    }
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => {
        const status = statuses[row.key] ?? { kind: "idle" as const };
        return (
          <div key={row.key} className="rounded-2xl border border-ink-line bg-ink-raised p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Nome do produto</span>
                <input
                  value={row.title}
                  onChange={(event) => updateRow(row.key, { title: event.target.value })}
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link de afiliado</span>
                <input
                  value={row.affiliateLink}
                  onChange={(event) => updateRow(row.key, { affiliateLink: event.target.value })}
                  placeholder="https://..."
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link da imagem</span>
                <input
                  value={row.image}
                  onChange={(event) => updateRow(row.key, { image: event.target.value })}
                  placeholder="https://..."
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Preço (R$)</span>
                <input
                  value={row.price}
                  onChange={(event) => updateRow(row.key, { price: event.target.value })}
                  inputMode="decimal"
                  placeholder="59,90"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Desconto % (opcional)</span>
                <input
                  value={row.discount}
                  onChange={(event) => updateRow(row.key, { discount: event.target.value })}
                  inputMode="numeric"
                  placeholder="25"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Categoria (opcional)</span>
                <input
                  value={row.category}
                  onChange={(event) => updateRow(row.key, { category: event.target.value })}
                  placeholder="deixe em branco pra sugerir automaticamente"
                  className="mt-2 w-full rounded-full border border-ink-line bg-ink px-4 py-2.5 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>

              <label className="block sm:col-span-2">
                <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">
                  Nota para a vitrine (obrigatória pra destacar)
                </span>
                <textarea
                  value={row.note}
                  onChange={(event) => updateRow(row.key, { note: event.target.value })}
                  placeholder="Por que essa oferta vale a pena? (mín. 15 caracteres)"
                  rows={2}
                  className="mt-2 w-full resize-y rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => submitRow(row)}
                disabled={status.kind === "saving" || status.kind === "saved"}
                className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status.kind === "saving"
                  ? "Cadastrando…"
                  : status.kind === "saved"
                    ? "Cadastrado ✓"
                    : "Cadastrar"}
              </button>
              {(() => {
                const highlightStatus = highlightStatuses[row.key] ?? { kind: "idle" as const };
                return (
                  <button
                    type="button"
                    onClick={() => highlightRow(row)}
                    disabled={highlightStatus.kind === "saving" || highlightStatus.kind === "saved"}
                    className="rounded-full border border-ink-line px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {highlightStatus.kind === "saving"
                      ? "Destacando…"
                      : highlightStatus.kind === "saved"
                        ? "Na vitrine ✓"
                        : "Destacar na vitrine"}
                  </button>
                );
              })()}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.key)}
                  className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                >
                  Remover
                </button>
              )}
              {status.kind === "saved" && (
                <span className="font-mono text-xs text-ash">categoria: {status.category}</span>
              )}
              {status.kind === "duplicate" && (
                <span role="alert" className="text-sm text-alert">
                  Esse link já foi cadastrado hoje.
                </span>
              )}
              {status.kind === "error" && (
                <span role="alert" className="text-sm text-alert">
                  {status.message}
                </span>
              )}
              {highlightStatuses[row.key]?.kind === "error" && (
                <span role="alert" className="text-sm text-alert">
                  {(highlightStatuses[row.key] as { kind: "error"; message: string }).message}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addRow}
        className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none"
      >
        Adicionar outro produto
      </button>
    </div>
  );
}
