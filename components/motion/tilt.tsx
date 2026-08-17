"use client";

import { useRef, type ReactNode } from "react";
import { cx } from "@/components/ui/utils";

/**
 * A surface that leans toward the pointer.
 *
 * The angles are written straight onto the element as custom properties, which
 * the `.tilt` class in globals.css consumes. That is deliberate: pointer
 * movement fires dozens of events a second, and putting those through React
 * state would re-render a card — and everything inside it — on every frame.
 * Writing two custom properties through a ref costs nothing and never touches
 * the React tree.
 *
 * The reduced-motion check is read at the moment of the event rather than
 * stored. It is cheap, it needs no effect and no state, and it means a guest
 * who changes the setting mid-visit is respected immediately.
 */
export function Tilt({
  children,
  className,
  /** Degrees at the far edge. Small on purpose — this should be felt, not seen. */
  maxTilt = 4,
  /** How far the surface comes toward the reader while hovered. */
  lift = 12,
  as: Component = "div",
}: {
  children: ReactNode;
  className?: string;
  maxTilt?: number;
  lift?: number;
  as?: "div" | "article" | "section" | "li";
}) {
  const ref = useRef<HTMLElement | null>(null);

  const prefersLessMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleMove = (event: React.PointerEvent<HTMLElement>) => {
    const element = ref.current;

    // Coarse pointers get nothing: a finger is already on the surface, and a
    // tilt that only appears mid-tap reads as a glitch.
    if (!element || event.pointerType !== "mouse" || prefersLessMotion()) {
      return;
    }

    const bounds = element.getBoundingClientRect();
    // -0.5 … 0.5 from the centre of the element.
    const fromCentreX = (event.clientX - bounds.left) / bounds.width - 0.5;
    const fromCentreY = (event.clientY - bounds.top) / bounds.height - 0.5;

    element.dataset.tilting = "true";
    // Y rotation follows horizontal travel; X is inverted so the edge nearest
    // the pointer comes forward rather than dipping away.
    element.style.setProperty("--tilt-y", `${fromCentreX * maxTilt * 2}deg`);
    element.style.setProperty("--tilt-x", `${-fromCentreY * maxTilt * 2}deg`);
    element.style.setProperty("--tilt-z", `${lift}px`);
  };

  const handleLeave = () => {
    const element = ref.current;
    if (!element) {
      return;
    }

    // Removing the attribute restores the eased transition, so the surface
    // settles back rather than snapping flat.
    delete element.dataset.tilting;
    element.style.setProperty("--tilt-x", "0deg");
    element.style.setProperty("--tilt-y", "0deg");
    element.style.setProperty("--tilt-z", "0px");
  };

  return (
    <Component
      ref={ref as never}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className={cx("tilt", className)}
    >
      {children}
    </Component>
  );
}
