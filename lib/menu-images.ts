// Images an admin can pick for a menu item (Admin > Products).
//
// Two kinds live under public/menu-art/:
// - Real product photos in /menu-art/photos/<slug>.webp (1800x1200, 3:2,
//   metadata stripped). MenuProductImage shows these as normal cropped photos;
//   next/image serves smaller resized copies to small screens.
// - The original illustrations, /menu-art/*.jpg. lib/menu-artwork.ts zooms
//   these exact paths onto a cream background. Never overwrite them; add new
//   photos at new paths instead.

export type MenuImageOption = { value: string; label: string; alt: string };

export const MENU_PHOTOS: readonly MenuImageOption[] = Object.freeze([
  { value: "/menu-art/photos/plain-focaccia.webp", label: "📷 Plain Focaccia (photo)", alt: "Two pieces of plain focaccia showing the airy, bubbly crumb" },
  { value: "/menu-art/photos/artisan-bread.webp", label: "📷 Artisan Bread (photo)", alt: "A rustic artisan loaf, sliced to show its open crumb and crackly crust" },
  { value: "/menu-art/photos/bagels-6-pack.webp", label: "📷 Bagels (photo)", alt: "Six seeded everything bagels on a wooden board" },
  { value: "/menu-art/photos/cookies-6-pack.webp", label: "📷 Cookies (photo)", alt: "A golden chocolate chip cookie on a baking tray" }
]);

export const MENU_ILLUSTRATIONS: readonly MenuImageOption[] = Object.freeze([
  { value: "/menu-art/focaccia.jpg", label: "🍞 Focaccia (illustration)", alt: "" },
  { value: "/menu-art/herb-focaccia.jpg", label: "🌿 Herb Focaccia (illustration)", alt: "" },
  { value: "/menu-art/artisan-bread.jpg", label: "🥖 Artisan Bread (illustration)", alt: "" },
  { value: "/menu-art/bagels.jpg", label: "🥯 Bagels (illustration)", alt: "" },
  { value: "/menu-art/cookies.jpg", label: "🍪 Cookies (illustration)", alt: "" }
]);

/** Photos first, then the illustrations, for the admin image pickers. */
export const MENU_IMAGE_OPTIONS: readonly MenuImageOption[] = Object.freeze([...MENU_PHOTOS, ...MENU_ILLUSTRATIONS]);

/** Alt text to store with a product image: the photo's description, else the product name. */
export function menuImageAlt(url: string | null | undefined, productName: string): string {
  const path = String(url ?? "").split(/[?#]/, 1)[0];
  return MENU_PHOTOS.find(photo => photo.value === path)?.alt || productName;
}
