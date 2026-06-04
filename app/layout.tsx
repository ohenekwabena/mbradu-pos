import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// The design system is Poppins (design.md §2; handoff prototype). 400/500/600 are
// the only weights used across the screens.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mbradu POS",
  description: "Point of sale for Mbradu Wigs & Cosmetics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
