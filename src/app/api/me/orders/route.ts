import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { listMyOrders } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** GET — история заказов со статусами доставки и трек-номерами. */
export async function GET(req: NextRequest) {
  const me = userId(requestUser(req));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });
  return NextResponse.json({ orders: await listMyOrders(me) });
}
