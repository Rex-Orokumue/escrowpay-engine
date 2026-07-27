export function formatNaira(amountInKobo: number): string {
  const naira = amountInKobo / 100;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
