"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/mercadolivre", label: "Hub Mercado Livre" },
  { href: "/admin/amazon", label: "Hub Amazon" },
  { href: "/admin/shopee", label: "Hub Shopee" },
  { href: "/admin/cadastro", label: "Cadastro manual" },
  { href: "/admin/postar", label: "Postar" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function linkClassName(active: boolean) {
    return `rounded-full px-4 py-2 font-mono text-[11px] tracking-wider uppercase transition focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none ${
      active ? "bg-gold text-ink" : "text-ash hover:text-paper"
    }`;
  }

  return (
    <div className="relative">
      <nav className="hidden items-center gap-x-1 gap-y-2 sm:flex sm:flex-wrap">
        {LINKS.map((link) => {
          const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
          return (
            <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={linkClassName(active)}>
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

      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls="admin-mobile-menu"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        className="flex size-10 items-center justify-center rounded-full border border-ink-line text-paper transition hover:border-gold hover:text-gold focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none sm:hidden"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <nav
          id="admin-mobile-menu"
          className="absolute top-full right-0 z-10 mt-2 flex w-56 flex-col gap-1 rounded-2xl border border-ink-line bg-ink-raised p-3 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.9)] sm:hidden"
        >
          {LINKS.map((link) => {
            const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined} className={linkClassName(active)}>
                {link.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 rounded-full border border-ink-line px-4 py-2 text-left font-mono text-[11px] tracking-wider text-ash uppercase transition hover:border-alert hover:text-alert focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
          >
            Sair
          </button>
        </nav>
      )}
    </div>
  );
}
