// ============================================================
// FEE CALCULATOR
// Calculates escrow fees based on platform type.
// Internal platform (Zolarux): 5% capped at ₦3,000
// External platforms: 5% capped at ₦5,000
// All amounts in kobo.
// ============================================================

const FEE_PERCENT = parseFloat(process.env.ESCROW_FEE_PERCENT || 5);
const FEE_MIN_KOBO = parseInt(process.env.ESCROW_FEE_MIN_KOBO || 10000, 10);
const FEE_CAP_INTERNAL = parseInt(process.env.ESCROW_FEE_CAP_INTERNAL_KOBO || 300000, 10);
const FEE_CAP_EXTERNAL = parseInt(process.env.ESCROW_FEE_CAP_EXTERNAL_KOBO || 500000, 10);

// Internal platform prefix — Zolarux
const INTERNAL_PREFIX = 'ZLX';

function calculateFee(amount, platformPrefix) {
  // Calculate raw fee
  const rawFee = Math.round((FEE_PERCENT / 100) * amount);

  // Determine cap based on platform
  const isInternal = platformPrefix === INTERNAL_PREFIX;
  const feeCap = isInternal ? FEE_CAP_INTERNAL : FEE_CAP_EXTERNAL;

  // Apply minimum and cap
  const fee = Math.min(Math.max(rawFee, FEE_MIN_KOBO), feeCap);

  return {
    fee,
    feeFormatted: `₦${(fee / 100).toFixed(2)}`,
    totalAmount: amount + fee,
    totalAmountFormatted: `₦${((amount + fee) / 100).toFixed(2)}`,
    feePercent: FEE_PERCENT,
    isInternal,
    breakdown: {
      orderAmount: amount,
      orderAmountFormatted: `₦${(amount / 100).toFixed(2)}`,
      rawFee,
      rawFeeFormatted: `₦${(rawFee / 100).toFixed(2)}`,
      feeCap,
      feeCapFormatted: `₦${(feeCap / 100).toFixed(2)}`
    }
  };
}

module.exports = { calculateFee };