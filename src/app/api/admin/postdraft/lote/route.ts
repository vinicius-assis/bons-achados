import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { getPostDraftById } from "@/lib/postdraft/store";
import { composeStory, fetchImageBuffer, loadMolduraDiagonalStory } from "@/lib/postdraft/images";
import { buildStoryManifest, ManifestValidationError } from "@/lib/postdraft/manifest";
import { createZip } from "@/lib/zip";

export const runtime = "nodejs";

function batchFilename(now: Date): string {
  const iso = now.toISOString().slice(0, 10);
  return `lote-${iso}.zip`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const ids: unknown = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const drafts = [];
  for (const id of ids as string[]) {
    const draft = await getPostDraftById(id);
    if (!draft) {
      return NextResponse.json({ error: "not_found", id }, { status: 404 });
    }
    drafts.push(draft);
  }

  const now = new Date();
  let manifest;
  try {
    manifest = buildStoryManifest(
      drafts.map((draft) => ({
        id: draft.id,
        title: draft.title,
        affiliateLink: draft.affiliateLink,
        marketplace: draft.marketplace,
      })),
      now
    );
  } catch (error) {
    if (error instanceof ManifestValidationError) {
      return NextResponse.json({ erro: "validacao", detalhes: error.detalhes }, { status: 422 });
    }
    throw error;
  }

  const moldura = loadMolduraDiagonalStory();
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const [index, draft] of drafts.entries()) {
    const productImage = await fetchImageBuffer(draft.image);
    const jpeg = await composeStory(
      productImage,
      moldura,
      draft.price,
      draft.imageTitle ?? draft.title
    );
    entries.push({ name: manifest.stories[index].imagem, data: new Uint8Array(jpeg) });
  }

  entries.unshift({
    name: "manifest.json",
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  const zip = createZip(entries);

  return new NextResponse(zip.buffer as ArrayBuffer, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${batchFilename(now)}"`,
    },
  });
}
