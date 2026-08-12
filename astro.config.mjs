// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Web jde na kořen domény aktivne-spolu.cz, proto base: "/".
// Výstup je čistě statický — obsahem složky dist/ se přímo nahradí root na FTP.
// Na hostingu WebGlobe běží jen statické soubory, žádné PHP.
export default defineConfig({
  site: "https://aktivne-spolu.cz",
  base: "/",
  output: "static",
  build: {
    // Adresáře místo .html souborů — hezčí adresy (/obchodni-podminky/)
    format: "directory",
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
