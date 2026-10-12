// These scales compensate for padding in the bundled illustrations, using the
// loaf as the visual reference. They are not product measurements or quantities.
const artwork: Readonly<Record<string, { scale: number; backgroundColor: string }>> = {
  "/menu-art/artisan-bread.jpg": { scale: 1, backgroundColor: "#fee7b5" },
  "/menu-art/bagels.jpg": { scale: 0.72, backgroundColor: "#fee7b3" },
  "/menu-art/cookies.jpg": { scale: 1.5, backgroundColor: "#ffebc6" },
  "/menu-art/herb-focaccia.jpg": { scale: 1.9, backgroundColor: "#ffeec3" },
  "/menu-art/focaccia.jpg": { scale: 1.42, backgroundColor: "#fdedbc" }
};

export function getMenuArtwork(src: string) {
  // Match only bundled assets, never a custom upload with a similar filename.
  const path = src.split(/[?#]/, 1)[0];
  return Object.hasOwn(artwork, path) ? artwork[path] : undefined;
}
