import { NextRequest, NextResponse } from "next/server";
import { getAmazonWebCookie, saveAmazonWebCookie } from "@/lib/amazon/session";
import { extractCookieHeader } from "@/lib/mercadolivre/parseCurl";
import { isAuthorizedAdminRequest } from "@/lib/adminSession";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ hasSession: (await getAmazonWebCookie()) !== null });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { curlCommand } = await request.json();
  if (!curlCommand) {
    return NextResponse.json({ error: "curlCommand is required" }, { status: 400 });
  }

  const cookieHeader = extractCookieHeader(curlCommand);
  if (!cookieHeader) {
    return NextResponse.json(
      { error: "Could not find the Cookie header in the pasted curl command" },
      { status: 400 }
    );
  }

  await saveAmazonWebCookie(cookieHeader);
  return NextResponse.json({ saved: true });
}
