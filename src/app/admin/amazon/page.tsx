import type { Metadata } from "next";
import AmazonAdmin from "./AmazonAdmin";

export const metadata: Metadata = {
  title: "Hub de afiliados Amazon · Bons Achados",
  description: "Veja as ofertas do mês da Amazon e copie o link de afiliado.",
};

export default function AmazonAdminPage() {
  return <AmazonAdmin />;
}
