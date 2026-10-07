// console.* that format objects. The host's console prints strings only;
// installConsole wraps it.

function key(k) {
  return /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
}

export function inspect(v, depth = 0, seen = new Set()) {
  switch (typeof v) {
    case 'string':
      return depth === 0 ? v : JSON.stringify(v);
    case 'function':
      return '[Function ' + (v.name || 'anonymous') + ']';
    case 'symbol':
      return v.toString();
    case 'bigint':
      return v + 'n';
    case 'object':
      break;
    default:
      return String(v);
  }
  if (v === null) return 'null';
  if (seen.has(v)) return '[Circular]';
  if (v instanceof Error) {
    const stack = v.stack ? '\n' + String(v.stack).replace(/\n$/, '') : '';
    return (v.name || 'Error') + ': ' + v.message + stack;
  }
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof ArrayBuffer) return 'ArrayBuffer(' + v.byteLength + ')';
  if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + (v.length ?? v.byteLength) + ')';
  if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen.add(v);
  let out;
  if (Array.isArray(v)) {
    const items = v.slice(0, 100).map((x) => inspect(x, depth + 1, seen));
    if (v.length > 100) items.push('... ' + (v.length - 100) + ' more');
    out = items.length ? '[ ' + items.join(', ') + ' ]' : '[]';
  } else if (v instanceof Map) {
    const items = [...v].map(([k, x]) => inspect(k, depth + 1, seen) + ' => ' + inspect(x, depth + 1, seen));
    out = 'Map(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}');
  } else if (v instanceof Set) {
    const items = [...v].map((x) => inspect(x, depth + 1, seen));
    out = 'Set(' + v.size + ') ' + (items.length ? '{ ' + items.join(', ') + ' }' : '{}');
  } else {
    const keys = Object.keys(v);
    const ctor = v.constructor;
    const name = ctor && ctor !== Object && ctor.name ? ctor.name + ' ' : '';
    out = keys.length
      ? name + '{ ' + keys.map((k) => key(k) + ': ' + inspect(v[k], depth + 1, seen)).join(', ') + ' }'
      : name + '{}';
  }
  seen.delete(v);
  return out;
}

export function format(args) {
  return args.map((a) => inspect(a)).join(' ');
}

export function installConsole(con) {
  const out = con.log;
  const err = con.error;
  for (const m of ['log', 'info', 'debug']) con[m] = (...args) => out(format(args));
  for (const m of ['warn', 'error']) con[m] = (...args) => err(format(args));
  con.trace = (...args) => err(format(args) + '\n' + new Error().stack);
  con.assert = (cond, ...args) => {
    if (!cond) err('Assertion failed' + (args.length ? ': ' + format(args) : ''));
  };
  con.dir = (v) => out(inspect(v, 1));
}
