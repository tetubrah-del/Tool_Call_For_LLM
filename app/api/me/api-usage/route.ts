import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCurrentPeriodUsage } from "@/lib/human-api-auth";
import { getCurrentHumanIdByEmail } from "@/lib/human-session";

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ status: "unauthorized" }, { status: 401 });

  const humanId = await getCurrentHumanIdByEmail(email);
  if (!humanId) return NextResponse.json({ status: "not_found" }, { status: 404 });

  const usage = await getCurrentPeriodUsage(humanId);
  if (!usage) return NextResponse.json({ status: "not_found" }, { status: 404 });

  return NextResponse.json({
    human_id: humanId,
    usage
  });
}
