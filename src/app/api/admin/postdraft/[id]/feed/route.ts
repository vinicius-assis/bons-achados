import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";
import { getPostDraftById } from "@/lib/postdraft/store";
import { composeFeedSlide, fetchImageBuffer, loadSelo } from "@/lib/postdraft/images";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const postDraft = await getPostDraftById(id);
  if (!postDraft) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const productImage = await fetchImageBuffer(postDraft.image);
  const jpeg = await composeFeedSlide(productImage, loadSelo(), postDraft.imageTitle ?? postDraft.title);

  return new NextResponse(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "content-disposition": `inline; filename="feed-${postDraft.id}.jpg"`,
    },
  });
}
