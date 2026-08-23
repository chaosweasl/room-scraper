import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Initialize the standard Next 14 font
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "KamerCatch",
  description:
    "Enschede student housing radar — automated room scraper with AI triage and Discord review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
