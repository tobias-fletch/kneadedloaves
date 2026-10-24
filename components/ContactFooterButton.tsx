"use client";

import Link from "next/link";
import React from "react";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { CONTACT_FORM_ID } from "@/lib/contact-form-anchor";


/**
 * The footer Contact button. On every other page it links to /contact. On /contact itself a
 * link to the current route is a no-op soft navigation, so instead it brings the form into view
 * and puts the cursor in the first field.
 */
export function ContactFooterButton({ href }: { href: string }) {
  const pathname = usePathname();

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (pathname !== href) return;
    const target = document.getElementById(CONTACT_FORM_ID);
    if (!target) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // The site header is sticky, so stop just below it rather than under it.
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const top = target.getBoundingClientRect().top + window.scrollY - Math.max(headerBottom, 0) - 16;
    window.scrollTo({ top: Math.max(top, 0), behavior: reduceMotion ? "auto" : "smooth" });
    const field = target.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([tabindex="-1"]), textarea, button'
    );
    field?.focus({ preventScroll: true });
  }

  return (
    <Link className="btn-primary w-full sm:w-auto" href={href} onClick={handleClick}>
      <MessageCircle size={18} aria-hidden="true" />
      Contact
    </Link>
  );
}
