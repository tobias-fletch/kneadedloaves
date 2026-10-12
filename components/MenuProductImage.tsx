import Image from "next/image";
import { getMenuArtwork } from "@/lib/menu-artwork";

export function MenuProductImage({ src, alt }: { src: string; alt: string }) {
  const artwork = getMenuArtwork(src);

  return (
    <div className="overflow-hidden border-b-2 border-ink">
      {artwork === undefined ? (
        <Image alt={alt} className="h-52 w-full object-cover" src={src} width={800} height={600} />
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
