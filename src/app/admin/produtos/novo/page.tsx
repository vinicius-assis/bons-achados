import type { Metadata } from "next";
import NovoProdutoForm from "./NovoProdutoForm";

export const metadata: Metadata = {
  title: "Cadastrar produto · Bons Achados",
  description: "Cadastro manual de produtos Amazon/Shopee para o gerador de posts.",
};

export default function NovoProdutoPage() {
  return (
    <div>
      <p className="font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
        Cadastro manual
      </p>
      <h1 className="font-display font-stretch-condensed text-3xl leading-none font-black text-paper uppercase italic sm:text-4xl">
        Novo <span className="text-gold">produto</span>
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-ash">
        Amazon e Shopee ainda não têm coleta automática — cadastre aqui os produtos que
        você já curou manualmente. Eles entram na fila de{" "}
        <a href="/admin/postar" className="text-gold underline decoration-gold/40 underline-offset-4">
          produtos para postar
        </a>
        .
      </p>
      <div className="mt-8">
        <NovoProdutoForm />
      </div>
    </div>
  );
}
