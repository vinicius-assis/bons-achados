export function isValidAdminCredentials(username: string, password: string): boolean {
  return username === process.env.ADMIN_USER && password === process.env.ADMIN_PASSWORD;
}
