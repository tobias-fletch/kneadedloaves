import Image from "next/image";
import { getMenuArtwork } from "@/lib/menu-artwork";
import { getMenuPhoto } from "@/lib/menu-images";

// Card widths: 1 column on phones, 2 from sm (640px), 3 from lg (1024px) inside
// the max-w-6xl (1152px) section. next/image uses this to pick a resized copy
// (e.g. ~640-828px wide on a phone) instead of the full 1800px original.
const PHOTO_SIZES = "(min-width: 1152px) 360px, (min-width: 1024px) 31vw, (min-width: 640px) 46vw, 100vw";

export function MenuProductImage({ src, alt }: { src: string; alt: string }) {
  const artwork = getMenuArtwork(src);
  const photo = getMenuPhoto(src);

  return (
    <div className="overflow-hidden border-b-2 border-ink">
      {photo?.fit === "contain" ? (
        // Cut-out photos (background removed): the whole item, centred on the card's cream colour.
        <div className="flex h-52 items-center justify-center bg-page p-4">
          <Image alt={alt} className="h-full w-full object-contain" src={src} width={photo.width} height={photo.height} sizes={PHOTO_SIZES} />
        </div>
      ) : artwork === undefined ? (
        // Real photos and custom uploads: a normal photo, cropped to fill the card.
        <Image alt={alt} className="h-52 w-full object-cover object-center" src={src} width={1800} height={1200} sizes={PHOTO_SIZES} />
      ) : (
        <div className="flex h-52 items-center justify-center overflow-hidden" style={{ backgroundColor: artwork.backgroundColor }}>
          <Image
            alt={alt}
            className="h-auto w-full max-w-[22rem] shrink-0"
            src={src}
            width={512}
            height={512}
            style={{ transform: `scale(${artwork.scale})` }}
          />
        </div>
      )}
    </div>
  );
}
