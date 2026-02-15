import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getNormalizedTask } from "@/lib/task-api";
import { OPERATOR_COUNTRY } from "@/lib/payments";
import { getRequestCountry } from "@/lib/request-country";
import {
  chooseDisplayCurrency,
  fromUsdForDisplay,
  minorToDisplayAmount,
  normalizeCurrencyCode
} from "@/lib/currency-display";

export async function GET(
  request: Request,
  { params }: { params: { taskId: string } }
) {
  const db = getDb();
  const requestCountry = getRequestCountry(request);
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const humanId = url.searchParams.get("human_id");
  const task = await getNormalizedTask(db, params.taskId, lang);
  if (!task) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  const quoteCurrency = normalizeCurrencyCode(task.quote_currency);
  const quoteAmountMinor = Number(task.quote_amount_minor);
  const displayCurrency = quoteCurrency || chooseDisplayCurrency(task.origin_country, requestCountry).toLowerCase();
  const displayAmount =
    quoteCurrency && Number.isInteger(quoteAmountMinor) && quoteAmountMinor >= 0
      ? minorToDisplayAmount(quoteAmountMinor, quoteCurrency)
      : fromUsdForDisplay(
          Number(task.budget_usd || 0),
          displayCurrency === "jpy" ? "JPY" : "USD"
        );
  let isInternationalPayout = false;
  if (humanId) {
    const human = await db
      .prepare(`SELECT * FROM humans WHERE id = ? AND deleted_at IS NULL`)
      .get(humanId);
    if (human?.country) {
      isInternationalPayout = human.country !== OPERATOR_COUNTRY;
    }
  }
  return NextResponse.json({
    task: {
      ...task,
      is_international_payout: isInternationalPayout,
      display_currency: displayCurrency,
      display_amount: displayAmount
    },
    request_country: requestCountry
  });
}
