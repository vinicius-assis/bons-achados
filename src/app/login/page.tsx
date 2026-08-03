import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { Suspense } from "react";
import Image from "next/image";
import LoginForm from "./LoginForm";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Entrar · Bons Achados",
  description: "Acesso ao painel interno do Bons Achados.",
};

export default function LoginPage() {
  return (
    <div className={`${archivo.variable} flex min-h-screen flex-col bg-ink font-body text-paper`}>
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/bons-achados.png"
              alt=""
              width={56}
              height={56}
              className="rounded-full"
              priority
            />
            <p className="mt-4 font-mono text-[11px] tracking-[0.22em] text-ash uppercase">
              Bons Achados
            </p>
            <h1 className="font-display font-stretch-condensed text-2xl leading-none font-black text-paper uppercase italic">
              Acesso <span className="text-gold">restrito</span>
            </h1>
          </div>

          <div className="mt-8 rounded-2xl border border-ink-line bg-ink-raised p-6 sm:p-8">
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
      <div className="h-1 bg-gold" />
    </div>
  );
}
