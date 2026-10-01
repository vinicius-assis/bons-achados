import { buildStoryManifest, type ManifestDraft } from "@/lib/postdraft/manifest";
import { createZip, type ZipEntry } from "@/lib/zip";

export type BatchItem = ManifestDraft;

type Options = {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
};

const DEFAULT_CONCURRENCY = 4;

// Builds the Stories batch zip on the client: one small request per story keeps
// every serverless call under Vercel's response-size and duration limits, which
// a single server-side zip of dozens of images blew through.
export async function buildBatchZip(
  items: BatchItem[],
  fetchStory: (id: string) => Promise<Uint8Array>,
  generatedAt: Date,
  { concurrency = DEFAULT_CONCURRENCY, onProgress }: Options = {}
): Promise<Uint8Array> {
  const manifest = buildStoryManifest(items, generatedAt);

  const images: Uint8Array[] = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      images[index] = await fetchStory(items[index].id);
      done += 1;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

  const entries: ZipEntry[] = [
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    ...manifest.stories.map((story, index) => ({ name: story.image, data: images[index] })),
  ];
  return createZip(entries);
}
