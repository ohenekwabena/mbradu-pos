import type { MetadataRoute } from "next";

/**
 * Web app manifest (ADR-0008 follow-up, GitHub #32): makes the POS installable
 * to a phone's home screen, opening standalone straight onto the Sell screen —
 * the counter's main job. Installing caches nothing by itself; see `public/sw.js`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Mbradu POS",
    short_name: "Mbradu",
    description: "Point of sale for Mbradu Wigs & Cosmetics",
    start_url: "/sell",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#fafafa",
    theme_color: "#c2185b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
