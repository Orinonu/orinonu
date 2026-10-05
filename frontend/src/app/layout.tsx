import type { Metadata, Viewport } from "next";
import { brand } from "@/lib/brand";
import "./globals.css";
export const metadata: Metadata = {
  title: brand.title,
  description: brand.description,
  applicationName: brand.name,
};
export const viewport: Viewport = { themeColor: "#050a18", colorScheme: "dark" };
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark">
      <body>{children}</body>
    </html>
  );
}
