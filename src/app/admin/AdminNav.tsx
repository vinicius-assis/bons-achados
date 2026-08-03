"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/produtos/novo", label: "Cadastrar produto" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-2 font-mono text-[11px] tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
              active ? "bg-gold text-ink" : "text-ash hover:text-paper"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={handleLogout}
        className="ml-1 rounded-full border border-ink-line px-4 py-2 font-mono text-[11px] tracking-wider text-ash uppercase transition hover:border-alert hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
      >
        Sair
      </button>
    </nav>
  );
}
