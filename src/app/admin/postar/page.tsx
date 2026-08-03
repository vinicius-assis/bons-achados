import type { Metadata } from "next";
import PostarQueue from "./PostarQueue";

export const metadata: Metadata = {
  title: "Produtos para postar · Bons Achados",
  description: "Fila de produtos selecionados, com imagens e legenda prontas pra postar.",
};

export default function PostarPage() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
        Gerador de posts
      </p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Produtos para <span className="text-gold">postar</span>
      </h1>
      <div className="mt-8">
        <PostarQueue />
      </div>
    </div>
  );
}
