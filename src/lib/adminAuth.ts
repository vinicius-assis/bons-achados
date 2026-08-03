export function isAuthorizedAdminRequest(request: Request): boolean {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Basic ")) {
    return false;
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const separatorIndex = decoded.indexOf(":");
  const providedUser = separatorIndex === -1 ? decoded : decoded.slice(0, separatorIndex);
  const providedPassword = separatorIndex === -1 ? "" : decoded.slice(separatorIndex + 1);

  return (
    providedUser === process.env.ADMIN_USER && providedPassword === process.env.ADMIN_PASSWORD
  );
}
