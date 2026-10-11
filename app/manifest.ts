import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kneaded Loaves",
    short_name: "Kneaded Loaves",
    description: "Order small-batch bakery goods and manage bakery operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf3",
    theme_color: "#9F2B45",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml"
      }
    ]
  };
}
