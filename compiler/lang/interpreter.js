import { PseudoError, ReturnSignal, StopSignal } from "./errors.js";
import { callBuiltin, BUILTIN_NAMES, valueToString, defaultValue, dateKey } from "./builtins.js";

const MAX_STEPS = 250000;
const YIELD_EVERY = 250;
const UNINIT = Symbol("uninit");

class Env {
  constructor(parent = null) {
    this.parent = parent;
    this.map = new Map();
  }
  define(name, slot) {
    this.map.set(name, slot);
  }
  find(name) {
    if (this.map.has(name)) return this.map.get(name);
    if (this.parent) return this.parent.find(name);
    return null;
  }
  findEnv(name) {
    if (this.map.has(name)) return this;
    if (this.parent) return this.parent.findEnv(name);
    return null;
  }
}

function makeArray(dims, elemType) {
  const dim = dims[0];
  const len = dim.upper - dim.lower + 1;
  const data = [];
  for (let i = 0; i < len; i++) {
    data.push(dims.length === 1 ? defaultValue(elemType) : makeArray(dims.slice(1), elemType));
  }
  return data;
}

function cloneValue(v) {
  if (v == null || v === UNINIT) return v;
  if (v.type === "DATE") return { type: "DATE", value: { ...v.value } };
  return { type: v.type, value: v.value };
}

export async function interpret(ast, io) {
  const env = new Env();
  const routines = new Map();
  let steps = 0;

  function collect(nodes) {
    if (!nodes) return;
    for (const n of nodes) {
      if (n.kind === "Procedure" || n.kind === "Function") routines.set(n.name, n);
      if (n.body) collect(n.body);
      if (n.thenBlock) collect(n.thenBlock);
      if (n.elseBlock) collect(n.elseBlock);
      if (n.branches) n.branches.forEach((b) => collect(b.statements));
      if (n.otherwise) collect(n.otherwise);
    }
  }
  collect(ast.statements);

  async function tick(line) {
    steps++;
    if (io.shouldStop()) throw new StopSignal();
    if (steps > MAX_STEPS) {
      throw new PseudoError(
        "This program ran too long, so it was stopped. Check for a loop that never ends.",
        line
      );
    }
    if (steps % YIELD_EVERY === 0) await Promise.resolve();
  }

  async function execBlock(nodes, local) {
    for (const n of nodes) await execStmt(n, local);
  }

  async function evalBound(expr, local, line) {
    const v = await evalExpr(expr, local);
    if (v.type !== "INTEGER") throw new PseudoError("Array bounds must be INTEGER.", line);
    return v.value;
  }

  async function execStmt(node, local) {
    await tick(node.line);
    switch (node.kind) {
      case "Declare": {
        if (node.dims) {
          const dims = [];
          for (const d of node.dims) {
            const lower = await evalBound(d.lower, local, node.line);
            const upper = await evalBound(d.upper, local, node.line);
            if (upper < lower) {
              throw new PseudoError(
                `Array "${node.name}" has an invalid range ${lower}:${upper}. The upper bound must be at least the lower bound.`,
                node.line
              );
            }
            dims.push({ lower, upper });
          }
          local.define(node.name, {
            kind: "array",
            type: node.dataType,
            dims,
            data: makeArray(dims, node.dataType),
            constant: false
          });
        } else {
          local.define(node.name, {
            kind: "var",
            type: node.dataType,
            value: UNINIT,
            constant: false
          });
        }
        return;
      }
      case "Constant": {
        const value = await evalExpr(node.value, local);
        local.define(node.name, {
          kind: "const",
          type: value.type,
          value,
          constant: true
        });
        return;
      }
      case "Assign": {
        const value = await evalExpr(node.expr, local);
        await setLValue(node.target, value, local);
        return;
      }
      case "Input": {
        const slotInfo = describeTarget(node.target);
        const raw = await io.input(slotInfo);
        if (io.shouldStop()) throw new StopSignal();
        const type = await lvalueType(node.target, local);
        const value = parseInput(raw, type, node.line, slotInfo);
        await setLValue(node.target, value, local);
        return;
      }
      case "Output": {
        const parts = [];
        for (const e of node.exprs) parts.push(valueToString(await evalExpr(e, local)));
        io.output(parts.join(""));
        return;
      }
      case "If": {
        const cond = await evalExpr(node.condition, local);
        expectBool(cond, node.line, "IF");
        if (cond.value) await execBlock(node.thenBlock, local);
        else if (node.elseBlock) await execBlock(node.elseBlock, local);
        return;
      }
      case "Case": {
        const current = getVar(node.name, local, node.line);
        let matched = false;
        for (const b of node.branches) {
          const from = await evalExpr(b.from, local);
          const to = b.to ? await evalExpr(b.to, local) : null;
          if (caseMatch(current, from, to)) {
            await execBlock(b.statements, local);
            matched = true;
            break;
          }
        }
        if (!matched && node.otherwise) await execBlock(node.otherwise, local);
        return;
      }
      case "For": {
        const start = await evalExpr(node.start, local);
        const end = await evalExpr(node.end, local);
        const stepVal = node.step ? await evalExpr(node.step, local) : { type: "INTEGER", value: 1 };
        if (start.type !== "INTEGER" || end.type !== "INTEGER" || stepVal.type !== "INTEGER") {
          throw new PseudoError("FOR start, end and STEP must be INTEGER.", node.line);
        }
        if (stepVal.value === 0) throw new PseudoError("FOR STEP cannot be 0.", node.line);
        const slot = requireVar(node.name, local, node.line);
        let i = start.value;
        const cmp = (a) => (stepVal.value > 0 ? a <= end.value : a >= end.value);
        while (cmp(i)) {
          slot.value = { type: "INTEGER", value: i };
          await execBlock(node.body, local);
          i += stepVal.value;
          await tick(node.line);
        }
        slot.value = { type: "INTEGER", value: i };
        return;
      }
      case "While": {
        while (true) {
          const cond = await evalExpr(node.condition, local);
          expectBool(cond, node.line, "WHILE");
          if (!cond.value) break;
          await execBlock(node.body, local);
        }
        return;
      }
      case "Repeat": {
        do {
          await execBlock(node.body, local);
          const cond = await evalExpr(node.condition, local);
          expectBool(cond, node.line, "UNTIL");
          if (cond.value) break;
        } while (true);
        return;
      }
      case "Procedure":
      case "Function":
        return;
      case "Call":
        await callRoutine(node.name, node.args, local, node.line, false);
        return;
      case "Return": {
        const value = await evalExpr(node.expr, local);
        throw new ReturnSignal(value);
      }
      case "OpenFile":
      case "ReadFile":
      case "WriteFile":
      case "CloseFile":
        throw new PseudoError(
          "File handling is not supported in the browser. OPENFILE, READFILE, WRITEFILE, CLOSEFILE and EOF cannot be used here.",
          node.line
        );
      default:
        throw new PseudoError(`Internal error: unknown statement ${node.kind}.`, node.line);
    }
  }

  function describeTarget(target) {
    if (target.kind === "Index") return target.name;
    return target.name;
  }

  async function lvalueType(target, local) {
    const slot = local.find(target.name);
    if (!slot) throw undeclared(target.name, target.line);
    return slot.type;
  }

  function requireVar(name, local, line) {
    const slot = local.find(name);
    if (!slot || (slot.kind !== "var" && slot.kind !== "const")) throw undeclared(name, line);
    if (slot.ref) return resolveRef(slot);
    return slot;
  }

  function resolveRef(slot) {
    let cur = slot;
    while (cur && cur.ref) {
      const owner = cur.ref.env;
      const inner = owner.map.get(cur.ref.name);
      if (cur.ref.indices) {
        return { kind: "elem", slot: inner, indices: cur.ref.indices, type: inner.type };
      }
      cur = inner;
    }
    return cur;
  }

  function getVar(name, local, line) {
    const slot = local.find(name);
    if (!slot) throw undeclared(name, line);
    const resolved = slot.ref ? resolveRef(slot) : slot;
    if (resolved.kind === "elem") return readIndex(resolved.slot, resolved.indices, line);
    if (resolved.kind === "array") {
      throw new PseudoError(`"${name}" is an array. Use an index, for example ${name}[1].`, line);
    }
    if (resolved.value === UNINIT) {
      throw new PseudoError(
        `"${name}" has no value yet. Assign something to it before using it.`,
        line
      );
    }
    return resolved.value;
  }

  function readIndex(slot, indices, line) {
    if (slot.kind !== "array") {
      throw new PseudoError(`"${slot.name || "this variable"}" is not an array.`, line);
    }
    if (indices.length !== slot.dims.length) {
      throw new PseudoError(
        `This array has ${slot.dims.length} dimension${slot.dims.length === 1 ? "" : "s"}.`,
        line
      );
    }
    let data = slot.data;
    for (let d = 0; d < indices.length; d++) {
      const idx = indices[d];
      const { lower, upper } = slot.dims[d];
      if (idx < lower || idx > upper) {
        throw new PseudoError(
          `Array index ${idx} is out of bounds. "${slotDisplay(slot)}" allows ${lower} to ${upper}.`,
          line
        );
      }
      data = data[idx - lower];
    }
    return data;
  }

  function slotDisplay(slot) {
    return slot.debugName || "array";
  }

  function writeIndex(slot, indices, value, line) {
    const coerced = coerceAssign(value, slot.type, line, "array element");
    if (indices.length !== slot.dims.length) {
      throw new PseudoError(
        `This array has ${slot.dims.length} dimension${slot.dims.length === 1 ? "" : "s"}.`,
        line
      );
    }
    if (indices.length === 1) {
      const { lower, upper } = slot.dims[0];
      const idx = indices[0];
      if (idx < lower || idx > upper) {
        throw new PseudoError(
          `Array index ${idx} is out of bounds. Valid indexes are ${lower} to ${upper}.`,
          line
        );
      }
      slot.data[idx - lower] = coerced;
      return;
    }
    const [i1, i2] = indices;
    const d1 = slot.dims[0];
    const d2 = slot.dims[1];
    if (i1 < d1.lower || i1 > d1.upper) {
      throw new PseudoError(`Array row index ${i1} is out of bounds. Valid indexes are ${d1.lower} to ${d1.upper}.`, line);
    }
    if (i2 < d2.lower || i2 > d2.upper) {
      throw new PseudoError(`Array column index ${i2} is out of bounds. Valid indexes are ${d2.lower} to ${d2.upper}.`, line);
    }
    slot.data[i1 - d1.lower][i2 - d2.lower] = coerced;
  }

  async function evalIndexValues(target, local) {
    const indices = [];
    for (const ix of target.indices) {
      const v = await evalExpr(ix, local);
      if (v.type !== "INTEGER") throw new PseudoError("Array indexes must be INTEGER.", target.line);
      indices.push(v.value);
    }
    return indices;
  }

  async function setLValue(target, value, local) {
    const slot = local.find(target.name);
    if (!slot) throw undeclared(target.name, target.line);
    const resolved = slot.ref ? resolveRef(slot) : slot;
    if (resolved.kind === "elem") {
      writeIndex(resolved.slot, resolved.indices, value, target.line);
      return;
    }
    if (resolved.constant) {
      throw new PseudoError(`"${target.name}" is a CONSTANT, so you cannot change it.`, target.line);
    }
    if (target.kind === "Index") {
      const indices = await evalIndexValues(target, local);
      resolved.debugName = target.name;
      writeIndex(resolved, indices, value, target.line);
      return;
    }
    resolved.value = coerceAssign(value, resolved.type, target.line, target.name);
  }

  function coerceAssign(value, type, line, name) {
    if (value.type === type) return cloneValue(value);
    if (value.type === "INTEGER" && type === "REAL") return { type: "REAL", value: value.value };
    if (type === "INTEGER" && value.type === "REAL" && Number.isInteger(value.value)) {
      return { type: "INTEGER", value: value.value };
    }
    throw new PseudoError(
      `"${name}" is ${type}, but you assigned a ${value.type}. The types must match.`,
      line
    );
  }

  async function evalExpr(node, local) {
    await tick(node.line);
    switch (node.kind) {
      case "Literal":
        if (node.dataType === "DATE") return { type: "DATE", value: node.value };
        return { type: node.dataType, value: node.value };
      case "Variable":
        return cloneValue(getVar(node.name, local, node.line));
      case "Index": {
        const slot = local.find(node.name);
        if (!slot) throw undeclared(node.name, node.line);
        const resolved = slot.ref ? resolveRef(slot) : slot;
        const arr = resolved.kind === "elem" ? resolved.slot : resolved;
        arr.debugName = node.name;
        const indices = await evalIndexValues(node, local);
        return cloneValue(readIndex(arr, indices, node.line));
      }
      case "Unary": {
        const v = await evalExpr(node.expr, local);
        if (node.op === "NOT") {
          expectBool(v, node.line, "NOT");
          return { type: "BOOLEAN", value: !v.value };
        }
        if (v.type !== "INTEGER" && v.type !== "REAL") {
          throw new PseudoError("A minus sign can only be used with INTEGER or REAL values.", node.line);
        }
        return { type: v.type, value: -v.value };
      }
      case "Binary":
        return evalBinary(node, local);
      case "FuncCall":
        return callRoutine(node.name, node.args, local, node.line, true);
      default:
        throw new PseudoError(`Internal error: unknown expression ${node.kind}.`, node.line);
    }
  }

  async function evalBinary(node, local) {
    const op = node.op;
    if (op === "AND") {
      const l = await evalExpr(node.left, local);
      expectBool(l, node.line, "AND");
      if (!l.value) return { type: "BOOLEAN", value: false };
      const r = await evalExpr(node.right, local);
      expectBool(r, node.line, "AND");
      return { type: "BOOLEAN", value: r.value };
    }
    if (op === "OR") {
      const l = await evalExpr(node.left, local);
      expectBool(l, node.line, "OR");
      if (l.value) return { type: "BOOLEAN", value: true };
      const r = await evalExpr(node.right, local);
      expectBool(r, node.line, "OR");
      return { type: "BOOLEAN", value: r.value };
    }
    const l = await evalExpr(node.left, local);
    const r = await evalExpr(node.right, local);
    if (op === "&") {
      const ls = l.type === "STRING" || l.type === "CHAR" ? l.value : null;
      const rs = r.type === "STRING" || r.type === "CHAR" ? r.value : null;
      if (ls == null || rs == null) {
        throw new PseudoError("& joins STRING or CHAR values.", node.line);
      }
      return { type: "STRING", value: ls + rs };
    }
    if (op === "+" || op === "-" || op === "*" || op === "/") {
      if (!isNum(l) || !isNum(r)) {
        throw new PseudoError(`You cannot use ${op} on ${l.type} and ${r.type}.`, node.line);
      }
      if (op === "/" && r.value === 0) throw new PseudoError("Division by zero is not allowed.", node.line);
      const lv = l.value;
      const rv = r.value;
      if (op === "/") return { type: "REAL", value: lv / rv };
      const result = op === "+" ? lv + rv : op === "-" ? lv - rv : lv * rv;
      const type = l.type === "INTEGER" && r.type === "INTEGER" ? "INTEGER" : "REAL";
      return { type, value: result };
    }
    return { type: "BOOLEAN", value: compare(l, r, op, node.line) };
  }

  function isNum(v) {
    return v.type === "INTEGER" || v.type === "REAL";
  }

  function compare(l, r, op, line) {
    let cmp;
    if (isNum(l) && isNum(r)) cmp = l.value === r.value ? 0 : l.value < r.value ? -1 : 1;
    else if (l.type === "DATE" && r.type === "DATE") {
      const a = dateKey(l.value);
      const b = dateKey(r.value);
      cmp = a === b ? 0 : a < b ? -1 : 1;
    } else if ((l.type === "STRING" || l.type === "CHAR") && (r.type === "STRING" || r.type === "CHAR")) {
      cmp = l.value === r.value ? 0 : l.value < r.value ? -1 : 1;
    } else if (l.type === r.type && (op === "EQ" || op === "NEQ")) {
      cmp = l.value === r.value ? 0 : 1;
    } else {
      throw new PseudoError(`You cannot compare ${l.type} with ${r.type}.`, line);
    }
    switch (op) {
      case "EQ": return cmp === 0;
      case "NEQ": return cmp !== 0;
      case "LT": return cmp < 0;
      case "GT": return cmp > 0;
      case "LEQ": return cmp <= 0;
      case "GEQ": return cmp >= 0;
      default: return false;
    }
  }

  function caseMatch(current, from, to) {
    if (!to) {
      if (current.type === "DATE" && from.type === "DATE") return dateKey(current.value) === dateKey(from.value);
      return current.value === from.value;
    }
    const lo = { type: "BOOLEAN", value: compare(current, from, "GEQ", from.line) };
    const hi = { type: "BOOLEAN", value: compare(current, to, "LEQ", to.line) };
    return lo.value && hi.value;
  }

  async function callRoutine(name, args, local, line, asFunc) {
    if (BUILTIN_NAMES.has(name)) {
      const values = [];
      for (const a of args) values.push(await evalExpr(a, local));
      return callBuiltin(name, values, line);
    }
    const fn = routines.get(name);
    if (!fn) {
      throw new PseudoError(
        asFunc
          ? `There is no function called "${name}".`
          : `There is no procedure called "${name}".`,
        line
      );
    }
    if (asFunc && fn.kind !== "Function") {
      throw new PseudoError(`"${name}" is a procedure. Use CALL ${name}(...).`, line);
    }
    if (!asFunc && fn.kind !== "Procedure") {
      throw new PseudoError(`"${name}" is a function. Use it in an expression, not CALL.`, line);
    }
    if (args.length !== fn.params.length) {
      throw new PseudoError(
        `"${name}" expects ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}, but you passed ${args.length}.`,
        line
      );
    }
    const child = new Env(env);
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const arg = args[i];
      if (p.mode === "BYREF") {
        if (arg.kind === "Variable") {
          const owner = local.findEnv(arg.name);
          if (!owner) throw undeclared(arg.name, line);
          child.define(p.name, { ref: { env: owner, name: arg.name }, type: p.dataType, kind: "var" });
        } else if (arg.kind === "Index") {
          const owner = local.findEnv(arg.name);
          if (!owner) throw undeclared(arg.name, line);
          const indices = await evalIndexValues(arg, local);
          child.define(p.name, {
            ref: { env: owner, name: arg.name, indices },
            type: p.dataType,
            kind: "var"
          });
        } else {
          throw new PseudoError(`Parameter "${p.name}" is BYREF, so you must pass a variable.`, line);
        }
      } else {
        const value = await evalExpr(arg, local);
        child.define(p.name, {
          kind: "var",
          type: p.dataType,
          value: coerceAssign(value, p.dataType, line, p.name),
          constant: false
        });
      }
    }
    try {
      await execBlock(fn.body, child);
    } catch (e) {
      if (e instanceof ReturnSignal) {
        if (!asFunc) {
          throw new PseudoError("RETURN can only be used inside a FUNCTION.", line);
        }
        return coerceAssign(e.value, fn.returnType, line, name);
      }
      throw e;
    }
    if (asFunc) {
      throw new PseudoError(`Function ${name} finished without RETURN.`, line);
    }
    return null;
  }

  function expectBool(v, line, where) {
    if (v.type !== "BOOLEAN") {
      throw new PseudoError(`${where} needs a BOOLEAN value (TRUE or FALSE).`, line);
    }
  }

  function undeclared(name, line) {
    return new PseudoError(
      `You used "${name}" but it was never declared. Add DECLARE ${name} : <type> first.`,
      line
    );
  }

  function parseInput(raw, type, line, name) {
    const text = String(raw ?? "");
    switch (type) {
      case "INTEGER": {
        if (!/^[+-]?\d+$/.test(text.trim())) {
          throw new PseudoError(`"${name}" is INTEGER, so enter a whole number.`, line);
        }
        return { type: "INTEGER", value: Number(text.trim()) };
      }
      case "REAL": {
        if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text.trim())) {
          throw new PseudoError(`"${name}" is REAL, so enter a number such as 3.5.`, line);
        }
        return { type: "REAL", value: Number(text.trim()) };
      }
      case "BOOLEAN": {
        const u = text.trim().toUpperCase();
        if (u === "TRUE") return { type: "BOOLEAN", value: true };
        if (u === "FALSE") return { type: "BOOLEAN", value: false };
        throw new PseudoError(`"${name}" is BOOLEAN, so enter TRUE or FALSE.`, line);
      }
      case "CHAR": {
        if (text.length !== 1) {
          throw new PseudoError(`"${name}" is CHAR, so enter exactly one character.`, line);
        }
        return { type: "CHAR", value: text };
      }
      case "STRING":
        return { type: "STRING", value: text };
      case "DATE": {
        const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) throw new PseudoError(`"${name}" is DATE, so enter DD/MM/YYYY.`, line);
        return {
          type: "DATE",
          value: { day: Number(m[1]), month: Number(m[2]), year: Number(m[3]), text: text.trim() }
        };
      }
      default:
        return { type: "STRING", value: text };
    }
  }

  await execBlock(ast.statements, env);
}
