// Fixed channels derive all decision noise/choice from one PRNG word.
export function decisionChannel(bits: number, channel: number): number {
    let z = (bits ^ Math.imul(channel + 1, 0x9e3779b9)) >>> 0;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 0x100000000;
}
