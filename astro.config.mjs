// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

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
  integrations: [
    sitemap({
      // /admin/ ven ze sitemapy stejně jako z robots.txt — je zamčená
      // přihlášením a nemá smysl na ni googlu ukazovat.
      // /zapis/ je jen pro osobní odkazy z e-mailu. /zasobnik/ je venku
      // ze sitemapy, dokud ho zadavatelka neodsouhlasí naostro.
      filter: (adresa) =>
        !adresa.includes("/admin/") &&
        !adresa.includes("/zapis/") &&
        !adresa.includes("/zasobnik/"),
    }),
  ],
});
