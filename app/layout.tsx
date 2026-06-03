import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Sniper | Polymarket & Kalshi 24/7",
  description: "Personal 24/7 automated trading system for prediction markets. Paper trading first. Real money only after rigorous validation.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark font-sans">
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-200">
        {/* Global risk banner - always visible */}
        <div className="w-full border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-center text-xs font-medium text-red-400">
          ⚠️ PERSONAL RISK TOOL — Paper trading is the default and strongly recommended. Real trading can result in total loss of capital. You are solely responsible.
        </div>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
