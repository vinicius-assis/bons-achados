// Placeholder card shown while a hub's pool loads or a search is in flight.
// Mirrors the real highlight <article> structure so the grid doesn't jump when
// results arrive. Shared by the Amazon, Mercado Livre and Shopee admin hubs.
export default function HighlightCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex animate-pulse flex-col overflow-hidden rounded-2xl bg-paper shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)]"
    >
      <div className="bg-white p-3">
        <div className="mx-auto h-40 w-full rounded-lg bg-ink/10" />
      </div>
      <div className="flex flex-1 flex-col gap-3 border-t border-ink/10 p-4">
        <div className="h-4 w-full rounded bg-ink/10" />
        <div className="h-4 w-2/3 rounded bg-ink/10" />
        <div className="h-7 w-28 rounded bg-ink/10" />
        <div className="mt-auto pt-1">
          <div className="h-10 w-full rounded-xl bg-ink/10" />
          <div className="mt-2 h-9 w-full rounded-full bg-ink/10" />
          <div className="mt-2 h-9 w-full rounded-full bg-ink/10" />
        </div>
      </div>
    </div>
  );
}
