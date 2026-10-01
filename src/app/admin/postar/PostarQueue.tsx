"use client";

import { useCallback, useEffect, useState } from "react";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import { copyToClipboard } from "@/lib/clipboard";
import { buildBatchZip } from "@/lib/postdraft/batchZip";
import { ManifestValidationError } from "@/lib/postdraft/manifest";
import { buildCaption, type CaptionProduct } from "@/lib/postdraft/caption";

type PostDraftItem = {
  id: string;
  title: string;
  affiliateLink: string;
  image: string;
  price: number;
  discount: number | null;
  marketplace: CaptionProduct["marketplace"];
  category: string | null;
};

// Small delay between sequential download triggers — firing them all in the
// same tick makes some browsers silently drop everything past the first one.
const BULK_DOWNLOAD_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Fetches the image as a blob instead of pointing <a download> at the API
// URL directly — the route serves `Content-Disposition: inline`, which
// Chrome honors over the anchor's `download` name, so a direct link ignores
// our selection-order filename.
async function downloadAsBlob(url: string, filename: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("download_failed");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [cleaningStale, setCleaningStale] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [downloadingStories, setDownloadingStories] = useState(false);
  const [downloadingFeeds, setDownloadingFeeds] = useState(false);
  const [downloadingLote, setDownloadingLote] = useState(false);
  const [loteProgress, setLoteProgress] = useState<{ done: number; total: number } | null>(null);

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
      setSelectedIds([]);
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

  async function handleCleanStale() {
    setCleaningStale(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/postdraft/clean-stale", { method: "POST" });
      if (!response.ok) {
        throw new Error("clean_stale_failed");
      }
      await load();
    } catch {
      setError("Não deu para limpar os itens de dias anteriores. Tente de novo.");
    } finally {
      setCleaningStale(false);
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
      setSelectedIds((current) => current.filter((id) => id !== itemId));
    } catch {
      setError("Não deu para remover o item. Tente de novo.");
    } finally {
      setRemovingItemId(null);
    }
  }

  function handleToggleSelect(itemId: string) {
    setSelectedIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    );
  }

  function handleSelectAll() {
    setSelectedIds(items.map((item) => item.id));
  }

  function handleClearSelection() {
    setSelectedIds([]);
  }

  const selectedItems = selectedIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is PostDraftItem => item !== undefined);
  const captionItems = selectedItems.length > 0 ? selectedItems : items;
  const caption = buildCaption(captionItems);
  const orderById = new Map(selectedIds.map((id, index) => [id, index + 1]));

  async function handleBulkDownload(kind: "story" | "feed") {
    const setDownloading = kind === "story" ? setDownloadingStories : setDownloadingFeeds;
    setDownloading(true);
    setError(null);
    let failures = 0;
    try {
      const total = selectedItems.length;
      const pad = String(total).length;
      for (const [index, item] of selectedItems.entries()) {
        const order = String(index + 1).padStart(pad, "0");
        try {
          await downloadAsBlob(`/api/admin/postdraft/${item.id}/${kind}`, `${kind}-${order}.jpg`);
        } catch {
          failures += 1;
        }
        if (index < total - 1) {
          await sleep(BULK_DOWNLOAD_DELAY_MS);
        }
      }
      if (failures > 0) {
        setError(`${failures} imagem${failures === 1 ? "" : "ns"} não baixaram. Tente de novo.`);
      }
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadLote() {
    setDownloadingLote(true);
    setLoteProgress(null);
    setError(null);
    try {
      const zip = await buildBatchZip(
        selectedItems,
        async (id) => {
          const response = await fetch(`/api/admin/postdraft/${id}/story`);
          if (!response.ok) {
            throw new Error(`story_failed:${id}:${response.status}`);
          }
          return new Uint8Array(await response.arrayBuffer());
        },
        new Date(),
        { onProgress: (done, total) => setLoteProgress({ done, total }) }
      );
      const objectUrl = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `lote-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      if (caught instanceof ManifestValidationError) {
        setError(`Lote inválido: ${caught.detalhes.join("; ")}`);
      } else {
        const reason = caught instanceof Error ? caught.message : "erro desconhecido";
        setError(`Não deu para gerar o lote (${reason}). Tente de novo.`);
      }
    } finally {
      setDownloadingLote(false);
      setLoteProgress(null);
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
            onClick={handleCleanStale}
            disabled={cleaningStale || items.length === 0}
            className="rounded-full border border-ink-line bg-ink-raised px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-paper uppercase italic transition hover:border-alert hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cleaningStale ? "Limpando…" : "Limpar itens de dias anteriores"}
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

      {items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-ink-line bg-ink-raised p-4">
          <p className="font-mono text-[11px] tracking-[0.2em] text-ash uppercase">
            {selectedItems.length > 0
              ? `${selectedItems.length} selecionado${selectedItems.length === 1 ? "" : "s"}`
              : "nenhum selecionado"}
          </p>
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={selectedItems.length === items.length}
            className="rounded-full border border-ink-line bg-ink px-4 py-1.5 font-mono text-[10px] tracking-wider text-paper uppercase transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Selecionar todos
          </button>
          <button
            type="button"
            onClick={handleClearSelection}
            disabled={selectedItems.length === 0}
            className="rounded-full border border-ink-line bg-ink px-4 py-1.5 font-mono text-[10px] tracking-wider text-paper uppercase transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Limpar seleção
          </button>
          <span className="mx-1 h-4 w-px bg-ink-line" aria-hidden="true" />
          <button
            type="button"
            onClick={() => handleBulkDownload("story")}
            disabled={selectedItems.length === 0 || downloadingStories}
            className="rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloadingStories ? "Baixando…" : "Baixar stories selecionados"}
          </button>
          <button
            type="button"
            onClick={() => handleBulkDownload("feed")}
            disabled={selectedItems.length === 0 || downloadingFeeds}
            className="rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloadingFeeds ? "Baixando…" : "Baixar feeds selecionados"}
          </button>
          <button
            type="button"
            onClick={handleDownloadLote}
            disabled={selectedItems.length === 0 || downloadingLote}
            className="flex-1 rounded-full bg-gold px-4 py-1.5 font-mono text-[10px] tracking-wider text-ink uppercase transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloadingLote
              ? `Gerando… ${loteProgress ? `${loteProgress.done}/${loteProgress.total}` : ""}`
              : "Baixar lote (.zip)"}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <p className="mt-10 max-w-md text-sm text-ash">
          Nada na fila agora. Cadastre um produto manual ou selecione itens no hub do
          Mercado Livre pra começar.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.id}
            className={`overflow-hidden rounded-2xl border p-4 transition ${
              orderById.has(item.id) ? "border-gold bg-ink-raised" : "border-ink-line bg-ink-raised"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <label className="flex min-w-0 items-start gap-2">
                <span className="relative mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={orderById.has(item.id)}
                    onChange={() => handleToggleSelect(item.id)}
                    aria-label={`Selecionar ${item.title}`}
                    className="size-4 rounded border-ink-line accent-gold"
                  />
                  {orderById.has(item.id) && (
                    <span className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full bg-gold font-mono text-[9px] font-bold text-ink">
                      {orderById.get(item.id)}
                    </span>
                  )}
                </span>
                <h2 className="line-clamp-2 text-sm leading-snug text-paper">{item.title}</h2>
              </label>
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
