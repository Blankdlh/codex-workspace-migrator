export function parseArgs(argv) {
  const out = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      out._.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }

    const eq = arg.indexOf("=");
    const rawKey = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const key = camelCase(rawKey);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);

    if (rawKey.startsWith("no-")) {
      out[camelCase(rawKey.slice(3))] = false;
      continue;
    }

    if (inlineValue != null) {
      out[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next != null && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }

  return out;
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

export function requireOption(options, key, flag) {
  const value = options[key];
  if (value == null || value === "" || value === true || value === false) {
    throw new Error(`Missing required option: ${flag}`);
  }
  return String(value);
}

