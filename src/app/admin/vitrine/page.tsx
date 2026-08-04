import type { Metadata } from "next";
import VitrineAdmin from "./VitrineAdmin";

export const metadata: Metadata = {
  title: "Vitrine · Bons Achados",
  description: "Destaques de hoje na vitrine pública.",
};

export default function VitrinePage() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
        Curadoria
      </p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Destaques da <span className="text-gold">vitrine</span>
      </h1>
      <div className="mt-8">
        <VitrineAdmin />
      </div>
    </div>
  );
}
