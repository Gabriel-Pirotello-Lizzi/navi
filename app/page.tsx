import type { Metadata } from "next";
import { requireChatGPTUser } from "./chatgpt-auth";
import { FinanceApp } from "./finance-app";

export const metadata: Metadata = {
  title: "Navi — controle financeiro",
  description: "Veja quanto pode gastar hoje, registre despesas e avance nas suas metas.",
};

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");

  return <FinanceApp firstName={user.displayName.split(" ")[0] || "você"} />;
}
