import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { applyReferral, getOrCreateCustomer, listBonusEvents, setCustomerPhone } from "@/lib/shop";

export const dynamic = "force-dynamic";

/** GET — профиль: имя из Telegram, телефон для доставки, бонусы, реферальный код. */
export async function GET(req: NextRequest) {
  const user = requestUser(req);
  const me = userId(user);
  if (!me || !user) return NextResponse.json(NO_AUTH, { status: 401 });

  const customer = await getOrCreateCustomer({
    tgUserId: me,
    firstName: user.first_name,
    username: user.username,
  });
  return NextResponse.json({ customer, bonusEvents: await listBonusEvents(me) });
}

/**
 * POST { action: "phone" | "referral", phone?, code? }
 * Телефон нужен один раз — дальше оформление в один тап.
 */
export async function POST(req: NextRequest) {
  let body: { initData?: string; action?: string; phone?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const me = userId(requestUser(req, body));
  if (!me) return NextResponse.json(NO_AUTH, { status: 401 });

  if (body.action === "phone") {
    const digits = String(body.phone ?? "").replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "Укажите телефон в формате +7 900 000-00-00" }, { status: 400 });
    }
    await setCustomerPhone(me, digits);
    return NextResponse.json({ ok: true, phone: digits });
  }

  if (body.action === "referral") {
    const result = await applyReferral(me, String(body.code ?? ""));
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
}
