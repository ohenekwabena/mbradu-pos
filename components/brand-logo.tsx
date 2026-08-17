import Image from "next/image";

/** The circular Mbradu badge (public/brand/logo.svg), sized by its container's
    tile class (.brand-mark / .auth-mark / .r-mark). Decorative: every call site
    pairs it with the wordmark or an aria-label, so alt stays empty. */
export function BrandLogo({ size }: { size: number }) {
  return <Image src="/brand/logo.svg" alt="" width={size} height={size} priority />;
}
