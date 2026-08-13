// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Web jde na kořen domény aktivne-spolu.cz, proto base: "/".
// Výstup je čistě statický — obsahem složky dist/ se přímo nahradí root na FTP.
// Na hostingu WebGlobe běží jen statické soubory, žádné PHP.
export default defineConfig({
  site: "https://aktivne-spolu.cz",
  // Ostrý web jde na kořen domény, takže "/". Náhled na GitHub Pages ale běží
  // v podadresáři, proto se dá kořen přebít proměnnou ASTRO_BASE
  // (viz `npm run nahled`). Build pro FTP se tím nemění.
  base: process.env.ASTRO_BASE ?? "/",
  output: "static",
  build: {
    // Adresáře místo .html souborů — hezčí adresy (/obchodni-podminky/)
    format: "directory",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
