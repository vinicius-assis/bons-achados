export function parseDiscountPercentage(label: string | null): number | null {
  if (!label) {
    return null;
  }
  const match = label.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}
