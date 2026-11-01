/** A "nice" axis maximum (1, 2, 2.5, 5 × 10ⁿ) at or above `value`. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * exp >= value) return step * exp;
  return 10 * exp;
}

/** Hour-based axis maximum for seconds: whole hours, at least 1 h. */
export function hoursAxisMax(maxSeconds: number): number {
  return Math.max(1, Math.ceil(niceMax(maxSeconds / 3600))) * 3600;
}

const point = (cx: number, cy: number, r: number, angle: number) => [
  cx + r * Math.cos(angle - Math.PI / 2),
  cy + r * Math.sin(angle - Math.PI / 2),
];

/** SVG path of a donut segment between two angles (radians, 0 = top, clockwise). */
export function donutSegment(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  from: number,
  to: number,
): string {
  // A full circle can't be one arc; stop just short of it.
  const end = to - from >= Math.PI * 2 ? from + Math.PI * 2 - 1e-4 : to;
  const large = end - from > Math.PI ? 1 : 0;
  const [x1, y1] = point(cx, cy, outer, from);
  const [x2, y2] = point(cx, cy, outer, end);
  const [x3, y3] = point(cx, cy, inner, end);
  const [x4, y4] = point(cx, cy, inner, from);
  const f = (n: number | undefined) => (n ?? 0).toFixed(3);
  return `M${f(x1)} ${f(y1)}A${outer} ${outer} 0 ${large} 1 ${f(x2)} ${f(y2)}L${f(x3)} ${f(y3)}A${inner} ${inner} 0 ${large} 0 ${f(x4)} ${f(y4)}Z`;
}

/** Angles of consecutive segments for values (empty when they sum to 0). */
export function segmentAngles(values: readonly number[]): { from: number; to: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  let angle = 0;
  return values.map((value) => {
    const from = angle;
    angle += (value / total) * Math.PI * 2;
    return { from, to: angle };
  });
}
