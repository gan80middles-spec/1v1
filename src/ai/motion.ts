import type { MotionParams, MotionState } from '../contracts/ai.js';
import type { Vec2 } from '../contracts/state.js';
import { limitVelocity, sweepCircles, lerpPosition } from '../math/geometry.js';
export function advanceMotion(body: MotionState, params: MotionParams, move: -1 | 0 | 1 | null, ticks: number, arena: {
    width: number;
    height: number;
    gravity: Vec2;
}): {
    wallSpeed: number;
    wall: 'left' | 'right' | 'ceiling' | 'floor' | null;
} {
    const dt = ticks / 60, oldX = body.velocity.x, oldY = body.velocity.y, support = body.grounded && body.velocity.y <= 0 && Math.abs(body.position.y - body.radius) < 1e-5;
    if (move !== null && move !== 0 && body.velocity.x * move < params.moveSpeed)
        body.velocity.x += move * Math.min((support ? params.groundAcceleration : params.airAcceleration) * dt, Math.max(0, params.moveSpeed - body.velocity.x * move));
    else if (move === 0)
        body.velocity.x -= Math.sign(body.velocity.x) * Math.min(Math.abs(body.velocity.x), (support ? 1400 : 120) * dt);
    if (!support) {
        body.velocity.y += arena.gravity.y * dt;
        body.velocity.x += arena.gravity.x * dt;
        body.grounded = false;
    }
    // Analytic semi-implicit gravity matches four physical substeps for an uninterrupted arc.
    body.position.x += (oldX + body.velocity.x) * .5 * dt;
    body.position.y += support ? 0 : oldY * dt + .5 * arena.gravity.y * dt * (dt + 1 / 240);
    limitVelocity(body.velocity);
    let wallSpeed = 0, wall: 'left' | 'right' | 'ceiling' | 'floor' | null = null;
    for (let count = 0; count < 4; count++) {
        if (body.position.x < body.radius && body.velocity.x < 0) {
            wall = 'left';
            wallSpeed = Math.abs(body.velocity.x);
            body.position.x = body.radius + (body.radius - body.position.x) * params.restitution;
            body.velocity.x = -body.velocity.x * params.restitution;
        }
        else if (body.position.x > arena.width - body.radius && body.velocity.x > 0) {
            wall = 'right';
            wallSpeed = Math.abs(body.velocity.x);
            body.position.x = arena.width - body.radius - (body.position.x - (arena.width - body.radius)) * params.restitution;
            body.velocity.x = -body.velocity.x * params.restitution;
        }
        else if (body.position.y < body.radius && body.velocity.y < 0) {
            wall = 'floor';
            wallSpeed = Math.abs(body.velocity.y);
            if (wallSpeed < 140) {
                body.position.y = body.radius;
                body.velocity.y = 0;
                body.grounded = true;
            }
            else {
                body.position.y = body.radius + (body.radius - body.position.y) * params.restitution;
                body.velocity.y = -body.velocity.y * params.restitution;
                body.grounded = false;
            }
        }
        else if (body.position.y > arena.height - body.radius && body.velocity.y > 0) {
            wall = 'ceiling';
            wallSpeed = Math.abs(body.velocity.y);
            body.position.y = arena.height - body.radius - (body.position.y - (arena.height - body.radius)) * params.restitution;
            body.velocity.y = -body.velocity.y * params.restitution;
        }
        else
            break;
    }
    body.position.x = Math.max(body.radius, Math.min(arena.width - body.radius, body.position.x));
    body.position.y = Math.max(body.radius, Math.min(arena.height - body.radius, body.position.y));
    limitVelocity(body.velocity);
    return { wallSpeed, wall };
}
export function resolvePredictedContact(a: MotionState, b: MotionState, fromA: Vec2, fromB: Vec2, dt: number, restitution: number): void {
    const hit = sweepCircles(fromA, a.position, a.radius, fromB, b.position, b.radius);
    if (hit === null)
        return;
    const pa = lerpPosition(fromA, a.position, hit), pb = lerpPosition(fromB, b.position, hit), dx = pb.x - pa.x, dy = pb.y - pa.y, d = Math.hypot(dx, dy), nx = d > 1e-7 ? dx / d : 1, ny = d > 1e-7 ? dy / d : 0, relative = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * ny;
    if (relative >= 0)
        return;
    const blockA = a.grounded && a.position.y <= a.radius + 1e-7 && ny > 0, blockB = b.grounded && b.position.y <= b.radius + 1e-7 && ny < 0, denominator = (nx * nx + (blockA ? 0 : ny * ny)) / a.mass + (nx * nx + (blockB ? 0 : ny * ny)) / b.mass, impulse = -(1 + restitution) * relative / denominator;
    a.velocity.x -= impulse * nx / a.mass;
    if (!blockA)
        a.velocity.y -= impulse * ny / a.mass;
    b.velocity.x += impulse * nx / b.mass;
    if (!blockB)
        b.velocity.y += impulse * ny / b.mass;
    a.position = { x: pa.x + a.velocity.x * dt * (1 - hit), y: pa.y + a.velocity.y * dt * (1 - hit) };
    b.position = { x: pb.x + b.velocity.x * dt * (1 - hit), y: pb.y + b.velocity.y * dt * (1 - hit) };
    limitVelocity(a.velocity);
    limitVelocity(b.velocity);
}
