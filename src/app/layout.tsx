import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import { SiteHeader } from "@/components/layout/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "us — just us.",
  description:
    "a private, campus-only space. verified students only — just us.",
  openGraph: {
    title: "us — just us.",
    description: "a private, campus-only space. just us.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        <SiteHeader />
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
