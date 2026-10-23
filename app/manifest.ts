import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kneaded Loaves",
    short_name: "Kneaded Loaves",
    description: "Order small-batch bakery goods and manage bakery operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#E9E4D3",
    theme_color: "#3B4527",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
