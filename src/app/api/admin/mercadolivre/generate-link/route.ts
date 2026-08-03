import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/mercadolivre/session";
import { MercadoLivreSessionExpiredError } from "@/lib/mercadolivre/hubClient";
import { createAffiliateLink, recordGeneratedLink } from "@/lib/mercadolivre/createLink";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { itemId, url, title } = body;

  if (!itemId || !url || !title) {
    return NextResponse.json(
      { error: "itemId, url and title are required" },
      { status: 400 }
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  try {
    const { shortUrl } = await createAffiliateLink(url, session);
    await recordGeneratedLink(itemId, title, shortUrl);
    return NextResponse.json({ affiliateLink: shortUrl });
  } catch (error) {
    if (error instanceof MercadoLivreSessionExpiredError) {
      return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }
    console.error("Mercado Livre generate-link failed:", error);
    return NextResponse.json({ error: "generate_link_failed" }, { status: 502 });
  }
}
