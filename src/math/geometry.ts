import type { Vec2 } from '../contracts/state.js';
export const EPSILON = 1e-7;
export function sweepCircles(a0: Vec2, a1: Vec2, ar: number, b0: Vec2, b1: Vec2, br: number): number | null {
    const x = a0.x - b0.x, y = a0.y - b0.y, dx = (a1.x - a0.x) - (b1.x - b0.x), dy = (a1.y - a0.y) - (b1.y - b0.y), r = ar + br;
    const c = x * x + y * y - r * r;
    if (c <= EPSILON)
        return 0;
    const aa = dx * dx + dy * dy;
    if (aa <= EPSILON)
        return null;
    const bb = 2 * (x * dx + y * dy), discriminant = bb * bb - 4 * aa * c;
    if (discriminant < 0)
        return null;
    const t = (-bb - Math.sqrt(discriminant)) / (2 * aa);
    return t >= -EPSILON && t <= 1 + EPSILON ? Math.max(0, Math.min(1, t)) : null;
}
export const lerpPosition = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function limitVelocity(velocity: {
    x: number;
    y: number;
}, limit = 1800): void {
    const speed = Math.hypot(velocity.x, velocity.y);
    if (!Number.isFinite(speed))
        throw new Error('non-finite velocity');
    if (speed > limit) {
        velocity.x *= limit / speed;
        velocity.y *= limit / speed;
    }
}
