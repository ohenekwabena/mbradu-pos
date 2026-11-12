import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

import { ServiceWorkerRegistration } from "@/components/service-worker";

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
  applicationName: "Mbradu POS",
  appleWebApp: { capable: true, title: "Mbradu", statusBarStyle: "default" },
};

// Brand-coloured browser chrome / installed-app title bar (#32).
export const viewport: Viewport = {
  themeColor: "#c2185b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
