import { NextRequest, NextResponse } from "next/server";
import { NO_AUTH, requestUser, userId } from "@/lib/api-user";
import { addReview, canReview, listReviews } from "@/lib/reviews";

export const dynamic = "force-dynamic";

/** GET /api/reviews?productId=… — отзывы и признак «можно ли написать свой». */
export async function GET(req: NextRequest) {
  const productId = req.nextUrl.searchParams.get("productId") ?? "";
  if (!productId) return NextResponse.json({ error: "Не указан товар" }, { status: 400 });

  const me = userId(requestUser(req));
  return NextResponse.json({
    reviews: await listReviews(productId),
    canReview: me ? await canReview(me, productId) : false,
  });
}

/** POST { productId, rating, text } — только после получения заказа. */
export async function POST(req: NextRequest) {
  let body: { initData?: string; productId?: string; rating?: number; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  const user = requestUser(req, body);
  const me = userId(user);
  if (!me || !user) return NextResponse.json(NO_AUTH, { status: 401 });

  const result = await addReview({
    tgUserId: me,
    productId: String(body.productId ?? ""),
    author: user.first_name ?? "Покупатель",
    rating: Number(body.rating ?? 0),
    text: String(body.text ?? ""),
  });

  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({ review: result.review, reviews: await listReviews(String(body.productId ?? "")) });
}
