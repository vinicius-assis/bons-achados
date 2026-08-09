"use client";

import { useState } from "react";
import type { Marketplace } from "@prisma/client";
import { detectMarketplace } from "@/lib/manualItems/detectMarketplace";

type RowStatus =
  | { kind: "idle" }
  | { kind: "created" }
  | { kind: "created_and_queued" }
  | { kind: "duplicate" }
  | { kind: "unrecognized_link" };

type FormRow = {
  key: string;
  imageLink: string;
  name: string;
  price: string;
  discount: string;
  affiliateLink: string;
  addToPost: boolean;
  status: RowStatus;
};

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
};

function emptyRow(): FormRow {
  return {
    key: crypto.randomUUID(),
    imageLink: "",
    name: "",
    price: "",
    discount: "",
    affiliateLink: "",
    addToPost: false,
    status: { kind: "idle" },
  };
}

function statusLabel(status: RowStatus): string | null {
  switch (status.kind) {
    case "created":
      return "✓ Cadastrado";
    case "created_and_queued":
      return "✓ Cadastrado + na fila";
    case "duplicate":
      return "⚠ Duplicado";
    case "unrecognized_link":
      return "⚠ Link não reconhecido";
    default:
      return null;
  }
}

export default function ManualItemsForm() {
  const [rows, setRows] = useState<FormRow[]>([emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(key: string, patch: Partial<FormRow>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((previous) => [...previous, emptyRow()]);
  }

  function removeRow(key: string) {
    setRows((previous) => (previous.length > 1 ? previous.filter((row) => row.key !== key) : previous));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const payloadItems = rows.map((row) => ({
      imageLink: row.imageLink.trim(),
      name: row.name.trim(),
      price: Number(row.price),
      discount: row.discount.trim() ? Number(row.discount) : null,
      affiliateLink: row.affiliateLink.trim(),
      addToPost: row.addToPost,
    }));

    try {
      const response = await fetch("/api/admin/manual-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: payloadItems }),
      });
      const body = await response.json();

      if (response.status === 400 && body.error === "unrecognized_link") {
        const unrecognized = new Set<number>(body.unrecognizedIndices);
        setRows((previous) =>
          previous.map((row, index) =>
            unrecognized.has(index) ? { ...row, status: { kind: "unrecognized_link" } } : row
          )
        );
        setError("Corrija o(s) link(s) marcados abaixo e cadastre de novo.");
        return;
      }

      if (!response.ok) {
        throw new Error("submit_failed");
      }

      const results = body.results as Array<{ status: RowStatus["kind"] }>;
      setRows((previous) => {
        const withStatus = previous.map((row, index) => ({
          ...row,
          status: { kind: results[index].status } as RowStatus,
        }));
        const remaining = withStatus.filter(
          (row) => row.status.kind !== "created" && row.status.kind !== "created_and_queued"
        );
        return remaining.length > 0 ? remaining : [emptyRow()];
      });
    } catch {
      setError("Não deu para cadastrar. Verifique a conexão e tente de novo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">Cadastro manual</p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Adicionar <span className="text-gold">itens</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ash">
        Cole o link de afiliado — o marketplace é detectado automaticamente (Mercado Livre,
        Amazon ou Shopee).
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-alert/40 bg-alert/10 px-4 py-3 text-sm text-paper">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {rows.map((row) => {
          const detected = detectMarketplace(row.affiliateLink.trim());
          const label = statusLabel(row.status);
          return (
            <div key={row.key} className="rounded-2xl border border-ink-line bg-ink-raised p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {detected ? (
                  <span className="rounded-full bg-gold/15 px-3 py-1 font-mono text-[10px] tracking-wider text-gold uppercase">
                    {MARKETPLACE_LABELS[detected]}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] tracking-wider text-ash uppercase">
                    marketplace não detectado
                  </span>
                )}
                <div className="flex items-center gap-3">
                  {label && (
                    <span className="font-mono text-[11px] tracking-wider text-gold uppercase">
                      {label}
                    </span>
                  )}
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="font-mono text-[11px] tracking-wider text-ash uppercase transition hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Nome</span>
                  <input
                    required
                    type="text"
                    value={row.name}
                    onChange={(event) => updateRow(row.key, { name: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link da imagem</span>
                  <input
                    required
                    type="text"
                    value={row.imageLink}
                    onChange={(event) => updateRow(row.key, { imageLink: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Preço (R$)</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={row.price}
                    onChange={(event) => updateRow(row.key, { price: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Desconto (%, opcional)</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="100"
                    value={row.discount}
                    onChange={(event) => updateRow(row.key, { discount: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="font-mono text-[11px] tracking-[0.18em] text-ash uppercase">Link afiliado</span>
                  <input
                    required
                    type="text"
                    value={row.affiliateLink}
                    onChange={(event) => updateRow(row.key, { affiliateLink: event.target.value })}
                    className="mt-2 w-full rounded-xl border border-ink-line bg-ink p-3 font-mono text-xs text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                  />
                </label>
              </div>

              <label className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.addToPost}
                  onChange={(event) => updateRow(row.key, { addToPost: event.target.checked })}
                  className="size-4 rounded border-ink-line bg-ink accent-gold"
                />
                <span className="font-mono text-[11px] tracking-wider text-ash uppercase">
                  Também adicionar para postar
                </span>
              </label>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={addRow}
            className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            + Adicionar item
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-gold px-7 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Cadastrando…" : "Cadastrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
