import type { Metadata } from "next";
import ShopeeAdmin from "./ShopeeAdmin";

export const metadata: Metadata = {
  title: "Hub Shopee · Bons Achados",
  description: "Busque produtos da Shopee e destaque ofertas com link de afiliado.",
};

export default function ShopeeAdminPage() {
  return <ShopeeAdmin />;
}
