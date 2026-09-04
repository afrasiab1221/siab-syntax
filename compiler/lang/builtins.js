import { PseudoError } from "./errors.js";

export const BUILTIN_NAMES = new Set([
  "LENGTH", "MID", "LEFT", "RIGHT", "UCASE", "LCASE",
  "NUM_TO_STRING", "STRING_TO_NUM",
  "MOD", "DIV", "ROUND", "RANDOM", "EOF"
]);

function asString(v, line) {
  if (v.type === "STRING" || v.type === "CHAR") return v.value;
  throw new PseudoError("This string function needs a STRING or CHAR value.", line);
}

function asNumeric(v, line) {
  if (v.type === "INTEGER" || v.type === "REAL") return v.value;
  throw new PseudoError("This numeric function needs an INTEGER or REAL value.", line);
}

function asInt(v, line, label) {
  if (v.type === "INTEGER") return v.value;
  if (v.type === "REAL" && Number.isInteger(v.value)) return v.value;
  throw new PseudoError(`${label} must be an INTEGER.`, line);
}

export function callBuiltin(name, args, line) {
  switch (name) {
    case "LENGTH":
      return { type: "INTEGER", value: asString(args[0], line).length };
    case "MID": {
      const s = asString(args[0], line);
      const start = asInt(args[1], line, "MID start");
      const length = asInt(args[2], line, "MID length");
      if (start < 1) {
        throw new PseudoError("MID start is 1-based, so it must be at least 1.", line);
      }
      if (length < 0) {
        throw new PseudoError("MID length cannot be negative.", line);
      }
      return { type: "STRING", value: s.slice(start - 1, start - 1 + length) };
    }
    case "LEFT": {
      const s = asString(args[0], line);
      const n = asInt(args[1], line, "LEFT count");
      if (n < 0) throw new PseudoError("LEFT count cannot be negative.", line);
      return { type: "STRING", value: s.slice(0, n) };
    }
    case "RIGHT": {
      const s = asString(args[0], line);
      const n = asInt(args[1], line, "RIGHT count");
      if (n < 0) throw new PseudoError("RIGHT count cannot be negative.", line);
      return { type: "STRING", value: n === 0 ? "" : s.slice(-n) };
    }
    case "UCASE":
      return { type: "STRING", value: asString(args[0], line).toUpperCase() };
    case "LCASE":
      return { type: "STRING", value: asString(args[0], line).toLowerCase() };
    case "NUM_TO_STRING": {
      const n = asNumeric(args[0], line);
      const text = args[0].type === "INTEGER" ? String(n) : formatReal(n);
      return { type: "STRING", value: text };
    }
    case "STRING_TO_NUM": {
      const s = asString(args[0], line).trim();
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) {
        throw new PseudoError(`"${s}" cannot be converted to a number.`, line);
      }
      const n = Number(s);
      if (!Number.isFinite(n)) throw new PseudoError(`"${s}" cannot be converted to a number.`, line);
      if (Number.isInteger(n) && !s.includes(".")) return { type: "INTEGER", value: n };
      return { type: "REAL", value: n };
    }
    case "MOD": {
      const x = asNumeric(args[0], line);
      const y = asNumeric(args[1], line);
      if (y === 0) throw new PseudoError("MOD cannot divide by zero.", line);
      return { type: "INTEGER", value: Math.trunc(x) - Math.trunc(y) * Math.trunc(Math.trunc(x) / Math.trunc(y)) };
    }
    case "DIV": {
      const x = asNumeric(args[0], line);
      const y = asNumeric(args[1], line);
      if (y === 0) throw new PseudoError("DIV cannot divide by zero.", line);
      return { type: "INTEGER", value: Math.trunc(Math.trunc(x) / Math.trunc(y)) };
    }
    case "ROUND": {
      const x = asNumeric(args[0], line);
      const places = asInt(args[1], line, "ROUND places");
      const f = 10 ** places;
      const rounded = Math.round((x + Number.EPSILON) * f) / f;
      return { type: "REAL", value: rounded };
    }
    case "RANDOM": {
      const n = 1000000;
      return { type: "REAL", value: Math.floor(Math.random() * (n + 1)) / n };
    }
    case "EOF":
      throw new PseudoError(
        "File handling is not supported in the browser. OPENFILE, READFILE, WRITEFILE, CLOSEFILE and EOF cannot be used here.",
        line
      );
    default:
      throw new PseudoError(`Unknown built-in ${name}.`, line);
  }
}

export function formatReal(n) {
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

export function valueToString(v) {
  if (v == null) return "";
  switch (v.type) {
    case "BOOLEAN": return v.value ? "TRUE" : "FALSE";
    case "DATE": return v.value.text || padDate(v.value);
    case "REAL": return formatReal(v.value);
    case "CHAR":
    case "STRING": return v.value;
    case "INTEGER": return String(v.value);
    default: return String(v.value);
  }
}

function padDate(d) {
  const dd = String(d.day).padStart(2, "0");
  const mm = String(d.month).padStart(2, "0");
  return `${dd}/${mm}/${d.year}`;
}

export function defaultValue(type) {
  switch (type) {
    case "INTEGER": return { type, value: 0 };
    case "REAL": return { type, value: 0 };
    case "CHAR": return { type, value: " " };
    case "STRING": return { type, value: "" };
    case "BOOLEAN": return { type, value: false };
    case "DATE": return { type, value: { day: 1, month: 1, year: 2000, text: "01/01/2000" } };
    default: return { type, value: null };
  }
}

export function dateKey(d) {
  return d.year * 10000 + d.month * 100 + d.day;
}
