import type { Metadata } from "next";
import MercadoLivreAdmin from "./MercadoLivreAdmin";

export const metadata: Metadata = {
  title: "Hub de afiliados · Bons Achados",
  description: "Busque produtos do Mercado Livre e gere links de afiliado.",
};

export default function MercadoLivreAdminPage() {
  return <MercadoLivreAdmin />;
}
