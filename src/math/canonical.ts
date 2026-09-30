export function canonicalSerialize(value: unknown): string {
  const visiting = new Set<object>();
  const visit = (item: unknown, path: string): string => {
    if (item === null) return 'null';
    if (typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error(`${path}: non-finite number`);
      return JSON.stringify(Object.is(item, -0) ? 0 : item);
    }
    if (typeof item !== 'object') throw new Error(`${path}: unsupported ${typeof item}`);
    if (visiting.has(item)) throw new Error(`${path}: cyclic value`);
    const prototype = Object.getPrototypeOf(item) as unknown;
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${path}: only plain objects are supported`);
    }
    if (Object.getOwnPropertySymbols(item).length) throw new Error(`${path}: symbol keys are unsupported`);
    visiting.add(item);
    let output: string;
    if (Array.isArray(item)) {
      const parts: string[] = [];
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) throw new Error(`${path}[${i}]: sparse array`);
        parts.push(visit(item[i], `${path}[${i}]`));
      }
      if (Object.keys(item).length !== item.length) throw new Error(`${path}: array properties are unsupported`);
      output = `[${parts.join(',')}]`;
    } else {
      const record = item as Record<string, unknown>;
      output = `{${Object.keys(record).sort().map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (descriptor?.get || descriptor?.set) throw new Error(`${path}.${key}: accessors are unsupported`);
        return `${JSON.stringify(key)}:${visit(record[key], `${path}.${key}`)}`;
      }).join(',')}}`;
    }
    visiting.delete(item);
    return output;
  };
  return visit(value, '$');
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
