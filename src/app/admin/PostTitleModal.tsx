"use client";

import { useState } from "react";

type PostTitleModalProps = {
  initialTitle: string;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (imageTitle: string) => void;
};

export default function PostTitleModal({
  initialTitle,
  submitting,
  onCancel,
  onConfirm,
}: PostTitleModalProps) {
  const [imageTitle, setImageTitle] = useState(initialTitle);
  const trimmed = imageTitle.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-title-modal-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-ink-line bg-ink-raised p-6">
        <h2
          id="post-title-modal-heading"
          className="font-display font-stretch-condensed text-lg font-black tracking-tight text-paper uppercase italic"
        >
          Título na imagem
        </h2>
        <p className="mt-2 text-sm text-ash">
          Esse texto aparece no topo do story e do feed gerados. Edite se quiser.
        </p>

        <label className="mt-4 block">
          <span className="sr-only">Título para a imagem</span>
          <textarea
            required
            autoFocus
            value={imageTitle}
            onChange={(event) => setImageTitle(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-xl border border-ink-line bg-ink p-3 text-sm text-paper placeholder:text-ash/60 focus-visible:border-gold focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
        </label>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="font-mono text-xs tracking-wider text-ash uppercase transition hover:text-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={submitting || !trimmed}
            className="rounded-full bg-gold px-6 py-2.5 font-display font-stretch-condensed text-sm font-black tracking-wide text-ink uppercase italic transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-ink-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Selecionando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
