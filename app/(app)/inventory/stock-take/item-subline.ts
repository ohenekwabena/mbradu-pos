import { attributeSummary, formatExpiry, type Attributes, type Category } from "@/lib/catalog";

/** Muted second line for a count/review row: a cosmetic shows size + expiry; a
 * wig or tool its attribute summary (mirrors the sell screen's card subline). */
export function itemSubline(category: Category, attributes: Attributes): string {
  if (category === "cosmetic") {
    const parts: string[] = [];
    if (attributes.size) parts.push(attributes.size);
    if (attributes.expiry) parts.push(`Exp ${formatExpiry(attributes.expiry)}`);
    return parts.join(" · ");
  }
  return attributeSummary(category, attributes);
}
