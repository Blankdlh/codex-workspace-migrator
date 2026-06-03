import os from "node:os";
import path from "node:path";

export function expandPath(input, cwd = process.cwd()) {
  if (input == null || input === "") return input;
  let value = String(input);
  if (value === "~") value = os.homedir();
  if (value.startsWith("~/")) value = path.join(os.homedir(), value.slice(2));
  return path.resolve(cwd, value);
}

export function normalizePath(input) {
  return path.resolve(input).replace(/\/+$/, "");
}

export function projectNameFromPath(projectPath) {
  return path.basename(projectPath.replace(/\/+$/, ""));
}

export function isInsideOrEqual(candidate, root) {
  const normalizedCandidate = normalizePath(candidate);
  const normalizedRoot = normalizePath(root);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export function buildPathRewrite(from, to) {
  return {
    from: normalizePath(from),
    exactTo: normalizePath(to),
    prefixTo: normalizePath(to),
    exactOnly: false,
  };
}

export function replaceKnownPath(value, rewrite) {
  if (typeof value !== "string") return value;
  const { from, exactTo, prefixTo, exactOnly = false } = rewrite;
  const normalizedFrom = from.replace(/\/+$/, "");
  const normalizedExactTo = exactTo.replace(/\/+$/, "");
  const normalizedPrefixTo = prefixTo.replace(/\/+$/, "");

  if (value === normalizedFrom) return normalizedExactTo;
  if (!exactOnly && value.startsWith(`${normalizedFrom}/`)) {
    return `${normalizedPrefixTo}${value.slice(normalizedFrom.length)}`;
  }

  return replacePathOccurrences(value, {
    from: normalizedFrom,
    exactTo: normalizedExactTo,
    prefixTo: normalizedPrefixTo,
    exactOnly,
  });
}

function replacePathOccurrences(value, rewrite) {
  const { from, exactTo, prefixTo, exactOnly } = rewrite;
  let next = "";
  let index = 0;

  while (index < value.length) {
    const found = value.indexOf(from, index);
    if (found === -1) {
      next += value.slice(index);
      break;
    }

    const before = found === 0 ? "" : value[found - 1];
    const after = value[found + from.length] || "";
    const beforeOk = before === "" || before === "\"" || before === "'" || before === "[" || before === ":" || before === "," || /\s/.test(before);
    const afterOk = exactOnly
      ? after === "" || after === "\"" || after === "'" || after === "]" || after === "," || /\s/.test(after)
      : after === "" || after === "/" || after === "\"" || after === "'" || after === "]" || after === "," || /\s/.test(after);
    const replacement = after === "/" && !exactOnly ? prefixTo : exactTo;
    const candidate = value.slice(found);
    const replacementAfter = candidate[replacement.length] || "";
    const replacementBoundaryOk =
      replacementAfter === "" ||
      replacementAfter === "/" ||
      replacementAfter === "\"" ||
      replacementAfter === "'" ||
      replacementAfter === "]" ||
      replacementAfter === "," ||
      /\s/.test(replacementAfter);
    const alreadyCanonical = candidate.startsWith(replacement) && replacementBoundaryOk;

    next += value.slice(index, found);
    if (beforeOk && afterOk && !alreadyCanonical) {
      next += replacement;
    } else {
      next += from;
    }
    index = found + from.length;
  }

  return next;
}

export function deepReplaceKnownPath(value, rewrite) {
  if (typeof value === "string") return replaceKnownPath(value, rewrite);
  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceKnownPath(item, rewrite));
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      const nextKey = replaceKnownPath(key, rewrite);
      const nextValue = deepReplaceKnownPath(child, rewrite);
      if (isPlainObject(out[nextKey]) && isPlainObject(nextValue)) {
        out[nextKey] = { ...out[nextKey], ...nextValue };
      } else {
        out[nextKey] = nextValue;
      }
    }
    return out;
  }
  return value;
}

export function replaceKnownPathInStructuredText(text, rewrite) {
  if (typeof text !== "string") return text;
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const original = JSON.parse(text);
      const replaced = deepReplaceKnownPath(original, rewrite);
      if (JSON.stringify(original) !== JSON.stringify(replaced)) return JSON.stringify(replaced);
    } catch {
      // Fall back to path-aware text replacement for non-JSON strings.
    }
  }
  return replaceKnownPath(text, rewrite);
}

export function structuredTextHasKnownPath(text, rewrite) {
  return typeof text === "string" && replaceKnownPathInStructuredText(text, rewrite) !== text;
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function pathExistsInText(text, rewrite) {
  return replaceKnownPath(text, rewrite) !== text;
}
