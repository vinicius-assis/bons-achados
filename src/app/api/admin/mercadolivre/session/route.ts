import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/mercadolivre/session";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ hasSession: session !== null });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { cookieHeader, csrfToken } = body;

  if (!cookieHeader || !csrfToken) {
    return NextResponse.json(
      { error: "cookieHeader and csrfToken are required" },
      { status: 400 }
    );
  }

  await saveSession(cookieHeader, csrfToken);

  return NextResponse.json({ saved: true });
}
