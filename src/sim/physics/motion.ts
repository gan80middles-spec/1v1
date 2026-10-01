import type { FighterEntity } from '../../contracts/fighter.js';
import type { Vec2 } from '../../contracts/state.js';
import { EPSILON, limitVelocity, sweepCircles } from '../../math/geometry.js';
export interface Material {
    restitution: number;
    moveSpeed: number;
    groundAcceleration: number;
    airAcceleration: number;
    jumpSpeed: number;
    damageTaken: number;
    knockbackTaken: number;
    meleeScale: number;
    wallGrowth: number;
}
export interface Segment {
    from: Vec2;
    to: Vec2;
    start: number;
    end: number;
}
export interface Bounce {
    entity: FighterEntity;
    wall: 'left' | 'right' | 'floor' | 'ceiling';
    incomingSpeed: number;
    position: Vec2;
}
export function separateBodies(entities: [
    FighterEntity,
    FighterEntity
], arena: {
    width: number;
    height: number;
}): void {
    const [a, b] = entities;
    const dx = b.body.position.x - a.body.position.x, dy = b.body.position.y - a.body.position.y, d = Math.hypot(dx, dy), overlap = a.body.radius + b.body.radius - d;
    if (overlap <= EPSILON)
        return;
    const nx = d > EPSILON ? dx / d : 1, ny = d > EPSILON ? dy / d : 0;
    const capacity = (e: FighterEntity, x: number, y: number): number => {
        const p = e.body.position, r = e.body.radius;
        return Math.max(0, Math.min(x > EPSILON ? (arena.width - r - p.x) / x : x < -EPSILON ? (r - p.x) / x : Infinity, y > EPSILON ? (arena.height - r - p.y) / y : y < -EPSILON ? (r - p.y) / y : Infinity));
    };
    const total = overlap + EPSILON;
    const ca = capacity(a, -nx, -ny), cb = capacity(b, nx, ny), wa = (1 / a.body.mass) / (1 / a.body.mass + 1 / b.body.mass);
    let ma = Math.min(ca, total * wa), mb = Math.min(cb, total - ma);
    ma = Math.min(ca, total - mb);
    mb = Math.min(cb, total - ma);
    a.body.position.x -= nx * ma;
    a.body.position.y -= ny * ma;
    b.body.position.x += nx * mb;
    b.body.position.y += ny * mb;
}
export function moveBodies(entities: [
    FighterEntity,
    FighterEntity
], materials: readonly [
    Material,
    Material
], moves: readonly (number | null)[], arena: {
    width: number;
    height: number;
    gravity: Vec2;
}, dt: number, onBounce: (bounce: Bounce) => void, onDiagnostic: (code: string, detail: string) => void = () => { },supportContacts=false): [
    Segment[],
    Segment[]
] {
    separateBodies(entities, arena);
    for (let i = 0; i < 2; i++) {
        const e = entities[i]!, body = e.body, m = materials[i]!, move = moves[i];
        body.position.x = Math.max(body.radius, Math.min(arena.width - body.radius, body.position.x));
        body.position.y = Math.max(body.radius, Math.min(arena.height - body.radius, body.position.y));
        const support = body.grounded && body.velocity.y <= 0 && Math.abs(body.position.y - body.radius) < EPSILON;
        if(supportContacts&&support)body.velocity.y=0;
        if (!support) {
            body.grounded = false;
            body.velocity.y += arena.gravity.y * dt;
            body.velocity.x += arena.gravity.x * dt;
        }
        const acc = body.grounded ? m.groundAcceleration : m.airAcceleration;
        if (move !== null && move !== undefined && move !== 0 && body.velocity.x * move < m.moveSpeed) {
            body.velocity.x += move * Math.min(acc * dt, Math.max(0, m.moveSpeed - body.velocity.x * move));
        }
        else if (move === 0) {
            const damping = body.grounded ? 1400 : 120;
            body.velocity.x -= Math.sign(body.velocity.x) * Math.min(Math.abs(body.velocity.x), damping * dt);
        }
        limitVelocity(body.velocity);
    }
    const paths: [
        Segment[],
        Segment[]
    ] = [[], []], wallCounts = [0, 0];
    let elapsed = 0;
    for (let iteration = 0; elapsed < dt - EPSILON; iteration++) {
        if (iteration > 12) {
            onDiagnostic('CONTACT_LIMIT', 'Stopped remaining substep displacement after contact iteration budget');
            break;
        }
        const remaining = dt - elapsed;
        type Contact = {
            time: number;
            kind: 'body';
        } | {
            time: number;
            kind: 'wall';
            index: number;
            wall: Bounce['wall'];
        };
        let earliest: Contact | null = null;
        const offer = (contact: Contact): void => {
            if (contact.time >= -EPSILON && contact.time <= remaining + EPSILON && (!earliest || contact.time < earliest.time - EPSILON))
                earliest = { ...contact, time: Math.max(0, contact.time) };
        };
        for (let i = 0; i < 2; i++) {
            const e = entities[i]!, p = e.body.position, v = e.body.velocity, r = e.body.radius;
            if (v.x < -EPSILON)
                offer({ time: (r - p.x) / v.x, kind: 'wall', index: i, wall: 'left' });
            if (v.x > EPSILON)
                offer({ time: (arena.width - r - p.x) / v.x, kind: 'wall', index: i, wall: 'right' });
            if (v.y < -EPSILON)
                offer({ time: (r - p.y) / v.y, kind: 'wall', index: i, wall: 'floor' });
            if (v.y > EPSILON)
                offer({ time: (arena.height - r - p.y) / v.y, kind: 'wall', index: i, wall: 'ceiling' });
        }
        const [a, b] = entities, pa = a.body.position, pb = b.body.position, va = a.body.velocity, vb = b.body.velocity;
        const bodyTime = sweepCircles(pa, { x: pa.x + va.x * remaining, y: pa.y + va.y * remaining }, a.body.radius, pb, { x: pb.x + vb.x * remaining, y: pb.y + vb.y * remaining }, b.body.radius);
        const rx = pb.x - pa.x, ry = pb.y - pa.y;
        if (bodyTime !== null && ((vb.x - va.x) * rx + (vb.y - va.y) * ry < -EPSILON))
            offer({ time: bodyTime * remaining, kind: 'body' });
        const contact = earliest as Contact | null;
        const travel = contact ? Math.min(remaining, contact.time) : remaining;
        for (let i = 0; i < 2; i++) {
            const body = entities[i]!.body, from = { ...body.position };
            body.position.x += body.velocity.x * travel;
            body.position.y += body.velocity.y * travel;
            if (travel > 0)
                paths[i]!.push({ from, to: { ...body.position }, start: elapsed / dt, end: (elapsed + travel) / dt });
        }
        elapsed += travel;
        if (!contact)
            break;
        if (contact.kind === 'body') {
            const dx = b.body.position.x - a.body.position.x, dy = b.body.position.y - a.body.position.y, d = Math.hypot(dx, dy), nx = d > EPSILON ? dx / d : 1, ny = d > EPSILON ? dy / d : 0;
            const relative = (b.body.velocity.x - a.body.velocity.x) * nx + (b.body.velocity.y - a.body.velocity.y) * ny;
            if (relative < 0) {
                const blockA=supportContacts&&a.body.grounded&&a.body.position.y<=a.body.radius+EPSILON&&ny>0,blockB=supportContacts&&b.body.grounded&&b.body.position.y<=b.body.radius+EPSILON&&ny<0;
                const denominator=supportContacts?(nx*nx+(blockA?0:ny*ny))/a.body.mass+(nx*nx+(blockB?0:ny*ny))/b.body.mass:1/a.body.mass+1/b.body.mass;
                const impulse = -(1 + Math.min(materials[0].restitution, materials[1].restitution)) * relative / denominator;
                a.body.velocity.x -= impulse * nx / a.body.mass;
                if(!blockA)a.body.velocity.y -= impulse * ny / a.body.mass;
                b.body.velocity.x += impulse * nx / b.body.mass;
                if(!blockB)b.body.velocity.y += impulse * ny / b.body.mass;
            }
            separateBodies(entities, arena);
            limitVelocity(a.body.velocity);
            limitVelocity(b.body.velocity);
        }
        else {
            const index = contact.index, e = entities[index]!, body = e.body, m = materials[index]!, horizontal = contact.wall === 'left' || contact.wall === 'right';
            if (++wallCounts[index]! > 4) {
                onDiagnostic('BOUNDARY_CONTACT_LIMIT', `Entity ${e.id}: stopped remaining substep displacement after four boundary contacts`);
                break;
            }
            const incomingSpeed = Math.abs(horizontal ? body.velocity.x : body.velocity.y);
            if (contact.wall === 'floor' && incomingSpeed < 140) {
                body.velocity.y = 0;
                body.position.y = body.radius;
                body.grounded = true;
            }
            else {
                if (horizontal)
                    body.velocity.x = -body.velocity.x * m.restitution;
                else
                    body.velocity.y = -body.velocity.y * m.restitution;
                body.grounded = false;
                onBounce({ entity: e, wall: contact.wall, incomingSpeed, position: { ...body.position } });
                limitVelocity(body.velocity);
            }
        }
    }
    if (elapsed < dt - EPSILON)
        for (let i = 0; i < 2; i++)
            paths[i]!.push({ from: { ...entities[i]!.body.position }, to: { ...entities[i]!.body.position }, start: elapsed / dt, end: 1 });
    for (let i = 0; i < 2; i++)
        if (!paths[i]!.length)
            paths[i]!.push({ from: { ...entities[i]!.body.position }, to: { ...entities[i]!.body.position }, start: 0, end: 1 });
    return paths;
}
