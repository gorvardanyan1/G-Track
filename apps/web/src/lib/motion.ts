import { gsap } from 'gsap';

/** Users who ask for less motion get none: every helper here finishes instantly for them. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** TransitionGroup @enter hook: list items slide in, slightly staggered. */
export function listEnter(el: Element, done: () => void): void {
  if (prefersReducedMotion()) return done();
  const index = Number((el as HTMLElement).dataset['index'] ?? 0);
  gsap.fromTo(
    el,
    { opacity: 0, y: 6 },
    {
      opacity: 1,
      y: 0,
      duration: 0.24,
      delay: Math.min(index, 10) * 0.025,
      ease: 'power2.out',
      clearProps: 'opacity,transform',
      onComplete: done,
    },
  );
}

/** TransitionGroup @leave hook. */
export function listLeave(el: Element, done: () => void): void {
  if (prefersReducedMotion()) return done();
  gsap.to(el, { opacity: 0, x: -8, duration: 0.16, ease: 'power1.in', onComplete: done });
}

/**
 * A change too small to be worth animating: live figures tick every second, and restarting a
 * 0.7 s count-up each tick means the number never settles.
 */
export function isTick(from: number, to: number): boolean {
  return Math.abs(to - from) <= Math.max(2, Math.abs(to) * 0.02);
}

const counting = new WeakMap<HTMLElement, gsap.core.Tween>();

/** Counts a number up from its previous value (dashboards, summary cards). */
export function countUp(
  el: HTMLElement,
  from: number,
  to: number,
  format: (value: number) => string,
): void {
  counting.get(el)?.kill();
  if (prefersReducedMotion() || isTick(from, to)) {
    el.textContent = format(to);
    return;
  }
  const state = { value: from };
  counting.set(
    el,
    gsap.to(state, {
      value: to,
      duration: 0.7,
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = format(Math.round(state.value));
      },
    }),
  );
}

/** Charts grow in from their baseline. */
export function growIn(targets: Element[], axis: 'x' | 'y' = 'y'): void {
  if (prefersReducedMotion() || targets.length === 0) return;
  gsap.from(targets, {
    [axis === 'y' ? 'scaleY' : 'scaleX']: 0,
    transformOrigin: axis === 'y' ? '50% 100%' : '0% 50%',
    duration: 0.5,
    ease: 'power3.out',
    stagger: 0.015,
  });
}
