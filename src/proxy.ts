import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorizedAdminRequest } from "@/lib/adminAuth";

const UNAUTHORIZED_RESPONSE = () =>
  new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
  });

export function proxy(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return UNAUTHORIZED_RESPONSE();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
