import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Navi — controle financeiro",
  description: "Seu dinheiro, mais claro todos os dias.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/favicon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Navi" },
  openGraph: {
    title: "Navi — controle financeiro",
    description: "Veja quanto pode gastar hoje e avance nas suas metas com clareza.",
    images: [{ url: "/og.png", width: 1792, height: 946, alt: "Navi — Seu dinheiro, mais claro." }],
  },
  twitter: { card: "summary_large_image", title: "Navi — controle financeiro", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
