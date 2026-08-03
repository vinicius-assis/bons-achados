import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import MercadoLivreAdmin from "./MercadoLivreAdmin";

// Heavy condensed italic, the same voice as the "ACHADOS" lettering in the mark.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Hub de afiliados · Bons Achados",
  description: "Busque produtos do Mercado Livre e gere links de afiliado.",
};

export default function MercadoLivreAdminPage() {
  return (
    <div className={archivo.variable}>
      <MercadoLivreAdmin />
    </div>
  );
}
