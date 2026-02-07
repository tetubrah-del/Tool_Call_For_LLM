export const MIN_BUDGET_USD = 5;
export const FEE_RATE = 0.2;
export const OPERATOR_COUNTRY = "JP";

export type PaymentBreakdown = {
  fee_rate: number;
  fee_amount: number;
  paypal_fee_amount: number;
  payout_amount: number;
};

export function calculateFeeAmount(budgetUsd: number) {
  const raw = budgetUsd * FEE_RATE * 100;
  return Math.ceil(raw) / 100;
}

export function calculatePayout(
  budgetUsd: number,
  paypalFeeUsd: number
): PaymentBreakdown {
  const fee_amount = calculateFeeAmount(budgetUsd);
  const payout_amount = Math.max(
    Number((budgetUsd - fee_amount - paypalFeeUsd).toFixed(2)),
    0
  );
  return {
    fee_rate: FEE_RATE,
    fee_amount,
    paypal_fee_amount: paypalFeeUsd,
    payout_amount
  };
}
