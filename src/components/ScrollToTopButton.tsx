"use client";

import { useEffect, useState } from "react";

const SHOW_AFTER_SCROLL_Y = 400;

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > SHOW_AFTER_SCROLL_Y);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function handleClick() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Voltar ao topo"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      className={`fixed right-6 z-50 flex size-12 items-center justify-center rounded-full bg-gold text-ink shadow-[0_10px_24px_-10px_rgba(0,0,0,0.6)] transition-opacity duration-300 hover:bg-gold-deep focus-visible:ring-2 focus-visible:ring-gold-deep focus-visible:outline-none ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-5">
        <path
          d="M10 15.5V4.5M5 9l5-5 5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
