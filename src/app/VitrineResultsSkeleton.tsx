// Fallback shown inside the vitrine's <Suspense> boundary while a new page of
// results streams in — on search, pagination, or filter changes. Mirrors the
// VitrineHighlights layout (sort row + card grid) so the page doesn't jump.

function VitrineCardSkeleton() {
  return (
    <div
      aria-hidden
      className="flex animate-pulse flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-[0_10px_24px_-14px_rgba(0,0,0,0.25)]"
    >
      <div className="bg-white p-3">
        <div className="mx-auto h-40 w-full rounded-lg bg-ink/10" />
      </div>
      <div className="flex flex-1 flex-col gap-2 border-t border-ink/10 p-4">
        <div className="h-5 w-24 rounded-full bg-ink/10" />
        <div className="h-4 w-full rounded bg-ink/10" />
        <div className="h-4 w-2/3 rounded bg-ink/10" />
        <div className="h-3 w-full rounded bg-ink/10" />
        <div className="h-3 w-1/2 rounded bg-ink/10" />
        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="h-3 w-12 rounded bg-ink/10" />
          <div className="h-5 w-20 rounded bg-ink/10" />
        </div>
        <div className="h-11 w-full rounded-xl bg-ink/10" />
        <div className="mx-auto h-3 w-24 rounded bg-ink/10" />
      </div>
    </div>
  );
}

export default function VitrineResultsSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 flex items-center justify-end">
        <div className="h-8 w-48 animate-pulse rounded-full bg-ink/10" />
      </div>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, index) => (
          <VitrineCardSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
