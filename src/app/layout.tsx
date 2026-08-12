import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const sans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AdLeverage — AI optimization for Google Ads",
    template: "%s · AdLeverage",
  },
  description:
    "Connect your Google Ads accounts and let an AI agent find wasted spend, scale what works, and keep every change under your control.",
  applicationName: "AdLeverage",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col bg-canvas text-foreground">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
