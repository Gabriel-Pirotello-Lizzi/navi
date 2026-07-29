import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "navi.local";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";

  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "Navi — controle financeiro",
    description: "Seu dinheiro, mais claro todos os dias.",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Navi — controle financeiro",
      description: "Veja quanto pode gastar hoje e avance nas suas metas com clareza.",
      images: [{ url: "/og.png", width: 1792, height: 946, alt: "Navi — Seu dinheiro, mais claro." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Navi — controle financeiro",
      description: "Seu dinheiro, mais claro todos os dias.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
