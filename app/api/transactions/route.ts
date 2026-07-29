import { desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { transactions } from "@/db/schema";

async function currentUserEmail() {
  const requestHeaders = await headers();
  return requestHeaders.get("oai-authenticated-user-email");
}

export async function GET() {
  const userEmail = await currentUserEmail();
  if (!userEmail) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const rows = await getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.userEmail, userEmail))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(100);

  return Response.json({ transactions: rows });
}

export async function POST(request: Request) {
  const userEmail = await currentUserEmail();
  if (!userEmail) return Response.json({ error: "Sign in is required." }, { status: 401 });

  const data = (await request.json()) as Record<string, unknown>;
  const kind = data.kind === "income" ? "income" : data.kind === "expense" ? "expense" : null;
  const amountCents = typeof data.amountCents === "number" ? Math.round(data.amountCents) : 0;
  const title = typeof data.title === "string" ? data.title.trim().slice(0, 100) : "";
  const category = typeof data.category === "string" ? data.category.trim().slice(0, 60) : "Outros";

  if (!kind || !title || amountCents < 1) {
    return Response.json({ error: "Invalid transaction data." }, { status: 400 });
  }

  const [transaction] = await getDb()
    .insert(transactions)
    .values({ userEmail, kind, amountCents, title, category })
    .returning();

  return Response.json({ transaction }, { status: 201 });
}
