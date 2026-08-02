import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const UNAUTHORIZED_RESPONSE = () =>
  new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Admin"' },
  });

export function proxy(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return UNAUTHORIZED_RESPONSE();
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const [providedUser, providedPassword] = decoded.split(":");

  if (providedUser !== process.env.ADMIN_USER || providedPassword !== process.env.ADMIN_PASSWORD) {
    return UNAUTHORIZED_RESPONSE();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
