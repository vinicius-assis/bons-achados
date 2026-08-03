import { Archivo } from "next/font/google";
import Image from "next/image";
import AdminNav from "./AdminNav";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  style: ["normal", "italic"],
});

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.variable} min-h-screen bg-ink font-body text-paper`}>
      <header className="border-b border-ink-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <Image
              src="/bons-achados.png"
              alt=""
              width={40}
              height={40}
              className="shrink-0 rounded-full"
              priority
            />
            <div>
              <p className="font-mono text-[10px] tracking-[0.22em] text-ash uppercase">
                Bons Achados
              </p>
              <p className="font-display font-stretch-condensed text-lg leading-none font-black text-paper uppercase italic">
                Painel interno
              </p>
            </div>
          </div>
          <AdminNav />
        </div>
        <div className="h-1 bg-gold" />
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
    </div>
  );
}
