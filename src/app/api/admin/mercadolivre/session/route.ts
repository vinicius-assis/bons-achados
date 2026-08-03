import { NextRequest, NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/mercadolivre/session";
import { parseCurlCommand } from "@/lib/mercadolivre/parseCurl";
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
  const { curlCommand } = body;

  if (!curlCommand) {
    return NextResponse.json({ error: "curlCommand is required" }, { status: 400 });
  }

  const parsed = parseCurlCommand(curlCommand);
  if (!parsed) {
    return NextResponse.json(
      { error: "Could not find the Cookie and x-csrf-token headers in the pasted curl command" },
      { status: 400 }
    );
  }

  await saveSession(parsed.cookieHeader, parsed.csrfToken);

  return NextResponse.json({ saved: true });
}
