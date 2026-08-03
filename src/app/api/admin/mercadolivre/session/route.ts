import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/mercadolivre/session";
import { isAuthorizedAdminRequest } from "@/lib/adminAuth";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await getSession();
  return NextResponse.json({ hasSession: session !== null });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
