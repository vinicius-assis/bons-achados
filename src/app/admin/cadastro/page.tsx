import type { Metadata } from "next";
import ManualItemsForm from "./ManualItemsForm";

export const metadata: Metadata = {
  title: "Cadastro manual · Bons Achados",
  description: "Cadastre um ou mais itens manualmente, com detecção automática do marketplace.",
};

export default function ManualItemsPage() {
  return <ManualItemsForm />;
}
