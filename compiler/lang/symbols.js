import { PseudoError } from "./errors.js";

export class Scope {
  constructor(parent = null, name = "global") {
    this.parent = parent;
    this.name = name;
    this.symbols = new Map();
  }

  define(sym) {
    this.symbols.set(sym.name, sym);
  }

  hasLocal(name) {
    return this.symbols.has(name);
  }

  lookup(name) {
    if (this.symbols.has(name)) return this.symbols.get(name);
    if (this.parent) return this.parent.lookup(name);
    return null;
  }
}

export function builtinSymbols() {
  const specs = [
    ["LENGTH", ["STRING"], "INTEGER"],
    ["MID", ["STRING", "INTEGER", "INTEGER"], "STRING"],
    ["LEFT", ["STRING", "INTEGER"], "STRING"],
    ["RIGHT", ["STRING", "INTEGER"], "STRING"],
    ["UCASE", ["STRING"], "STRING"],
    ["LCASE", ["STRING"], "STRING"],
    ["NUM_TO_STRING", ["NUMERIC"], "STRING"],
    ["STRING_TO_NUM", ["STRING"], "NUMBER"],
    ["MOD", ["NUMERIC", "NUMERIC"], "INTEGER"],
    ["DIV", ["NUMERIC", "NUMERIC"], "INTEGER"],
    ["ROUND", ["NUMERIC", "INTEGER"], "REAL"],
    ["RANDOM", [], "REAL"],
    ["EOF", ["STRING"], "BOOLEAN"]
  ];
  return specs.map(([name, params, returnType]) => ({
    kind: "builtin",
    name,
    params: params.map((dataType, i) => ({ name: `arg${i + 1}`, dataType, mode: "BYVAL" })),
    returnType,
    dataType: returnType
  }));
}

export function collectRoutines(ast, scope) {
  walk(ast, (node) => {
    if (node.kind !== "Procedure" && node.kind !== "Function") return;
    if (scope.hasLocal(node.name)) {
      throw new PseudoError(
        `"${node.name}" is already declared. Choose a different name.`,
        node.line
      );
    }
    if (node.kind === "Procedure") {
      scope.define({
        kind: "procedure",
        name: node.name,
        params: node.params,
        node,
        line: node.line
      });
    } else {
      scope.define({
        kind: "function",
        name: node.name,
        params: node.params,
        returnType: node.returnType,
        node,
        line: node.line
      });
    }
  });
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit));
    return;
  }
  if (node.kind) visit(node);
  for (const key of Object.keys(node)) {
    if (key === "kind") continue;
    walk(node[key], visit);
  }
}
