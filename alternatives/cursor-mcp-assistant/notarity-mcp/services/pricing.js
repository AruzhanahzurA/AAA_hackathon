export function computeConfirmedPrice(priceLines) {
  if (!Array.isArray(priceLines)) return 0;
  const cents = priceLines.reduce((sum, line) => sum + (line.net || 0), 0);
  return cents / 100;
}
