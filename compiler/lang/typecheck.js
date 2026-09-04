import { PseudoError } from "./errors.js";
import { Scope, builtinSymbols, collectRoutines } from "./symbols.js";

const NUMERIC = new Set(["INTEGER", "REAL", "NUMERIC", "NUMBER"]);
const ORDERED = new Set(["INTEGER", "REAL", "CHAR", "STRING", "DATE", "NUMBER", "NUMERIC"]);

function canAssign(from, to) {
  if (from === to) return true;
  if (from === "INTEGER" && to === "REAL") return true;
  if (from === "NUMBER" && (to === "INTEGER" || to === "REAL" || to === "NUMERIC")) return true;
  if (from === "NUMERIC" && (to === "INTEGER" || to === "REAL" || to === "NUMBER")) return true;
  if ((from === "INTEGER" || from === "REAL") && (to === "NUMERIC" || to === "NUMBER")) return true;
  return false;
}

function argCompatible(from, expected) {
  if (expected === "NUMERIC") return NUMERIC.has(from);
  if (expected === "STRING") return from === "STRING" || from === "CHAR";
  return canAssign(from, expected) || from === expected;
}

function undeclared(name, line) {
  return new PseudoError(
    `You used "${name}" but it was never declared. Add DECLARE ${name} : <type> first.`,
    line
  );
}

function hasReturn(nodes) {
  if (!nodes) return false;
  for (const n of nodes) {
    if (!n) continue;
    if (n.kind === "Return") return true;
    if (hasReturn(n.thenBlock) || hasReturn(n.elseBlock) || hasReturn(n.body) || hasReturn(n.otherwise)) return true;
    if (n.branches && n.branches.some((b) => hasReturn(b.statements))) return true;
    if (n.statements && hasReturn(n.statements)) return true;
  }
  return false;
}

export function typecheck(ast) {
  const global = new Scope(null, "global");
  for (const b of builtinSymbols()) global.define(b);
  collectRoutines(ast, global);

  const ctx = { scope: global, inFunction: null, inProcedure: null };

  function checkStmts(stmts) {
    for (const s of stmts) checkStmt(s);
  }

  function declareVar(node) {
    if (ctx.scope.hasLocal(node.name)) {
      throw new PseudoError(
        `"${node.name}" is already declared in this scope. Choose a different name.`,
        node.line
      );
    }
    const existing = ctx.scope.lookup(node.name);
    if (existing && (existing.kind === "procedure" || existing.kind === "function" || existing.kind === "builtin")) {
      throw new PseudoError(
        `"${node.name}" is already used as a ${existing.kind}. Choose a different name.`,
        node.line
      );
    }
    if (node.dims) {
      for (const d of node.dims) {
        const lt = exprType(d.lower);
        const ut = exprType(d.upper);
        if (lt !== "INTEGER" || ut !== "INTEGER") {
          throw new PseudoError("Array bounds must be INTEGER values.", node.line);
        }
      }
      ctx.scope.define({
        kind: "array",
        name: node.name,
        dataType: node.dataType,
        dims: node.dims.length,
        line: node.line
      });
    } else {
      ctx.scope.define({
        kind: "var",
        name: node.name,
        dataType: node.dataType,
        constant: false,
        line: node.line
      });
    }
  }

  function checkStmt(node) {
    switch (node.kind) {
      case "Declare":
        declareVar(node);
        return;
      case "Constant": {
        if (ctx.scope.hasLocal(node.name)) {
          throw new PseudoError(`"${node.name}" is already declared.`, node.line);
        }
        const t = exprType(node.value);
        ctx.scope.define({
          kind: "const",
          name: node.name,
          dataType: t === "NUMBER" ? "REAL" : t,
          constant: true,
          line: node.line
        });
        return;
      }
      case "Assign": {
        const targetType = lvalueType(node.target, true);
        const valueType = exprType(node.expr);
        if (!canAssign(valueType, targetType)) {
          throw new PseudoError(
            `"${lvalueName(node.target)}" is ${targetType}, but you assigned a ${valueType}. The types must match (INTEGER can be stored in a REAL).`,
            node.line
          );
        }
        return;
      }
      case "Input":
        lvalueType(node.target, true);
        return;
      case "Output":
        node.exprs.forEach((e) => exprType(e));
        return;
      case "If": {
        const ct = exprType(node.condition);
        if (ct !== "BOOLEAN") {
          throw new PseudoError("An IF condition must be BOOLEAN, for example Count < 10 OR Flag = TRUE.", node.line);
        }
        checkStmts(node.thenBlock);
        if (node.elseBlock) checkStmts(node.elseBlock);
        return;
      }
      case "Case": {
        const sym = ctx.scope.lookup(node.name);
        if (!sym || (sym.kind !== "var" && sym.kind !== "const")) {
          throw undeclared(node.name, node.line);
        }
        for (const b of node.branches) {
          const ft = exprType(b.from);
          if (!canAssign(ft, sym.dataType) && ft !== sym.dataType) {
            throw new PseudoError(
              `CASE value type ${ft} does not match ${node.name} (${sym.dataType}).`,
              b.from.line
            );
          }
          if (b.to) {
            const tt = exprType(b.to);
            if (tt !== ft) {
              throw new PseudoError("A CASE range must use two values of the same type.", b.to.line);
            }
          }
          checkStmts(b.statements);
        }
        if (node.otherwise) checkStmts(node.otherwise);
        return;
      }
      case "For": {
        const sym = ctx.scope.lookup(node.name);
        if (!sym || (sym.kind !== "var" && sym.kind !== "const")) throw undeclared(node.name, node.line);
        if (sym.constant) {
          throw new PseudoError(`"${node.name}" is a CONSTANT, so it cannot be the FOR counter.`, node.line);
        }
        if (sym.dataType !== "INTEGER") {
          throw new PseudoError(`FOR counter "${node.name}" must be INTEGER.`, node.line);
        }
        const st = exprType(node.start);
        const et = exprType(node.end);
        if (st !== "INTEGER" || et !== "INTEGER") {
          throw new PseudoError("FOR start and end values must be INTEGER.", node.line);
        }
        if (node.step) {
          const sp = exprType(node.step);
          if (sp !== "INTEGER") throw new PseudoError("FOR STEP must be INTEGER.", node.line);
        }
        checkStmts(node.body);
        return;
      }
      case "While": {
        if (exprType(node.condition) !== "BOOLEAN") {
          throw new PseudoError("A WHILE condition must be BOOLEAN.", node.line);
        }
        checkStmts(node.body);
        return;
      }
      case "Repeat": {
        checkStmts(node.body);
        if (exprType(node.condition) !== "BOOLEAN") {
          throw new PseudoError("A REPEAT loop needs a BOOLEAN condition after UNTIL.", node.line);
        }
        return;
      }
      case "Procedure": {
        const prev = { ...ctx };
        ctx.scope = new Scope(global, node.name);
        ctx.inProcedure = node.name;
        ctx.inFunction = null;
        for (const p of node.params) {
          ctx.scope.define({ kind: "var", name: p.name, dataType: p.dataType, constant: false, byref: p.mode === "BYREF" });
        }
        checkStmts(node.body);
        ctx.scope = prev.scope;
        ctx.inProcedure = prev.inProcedure;
        ctx.inFunction = prev.inFunction;
        return;
      }
      case "Function": {
        const prev = { ...ctx };
        ctx.scope = new Scope(global, node.name);
        ctx.inFunction = node;
        ctx.inProcedure = null;
        for (const p of node.params) {
          ctx.scope.define({ kind: "var", name: p.name, dataType: p.dataType, constant: false, byref: p.mode === "BYREF" });
        }
        checkStmts(node.body);
        if (!hasReturn(node.body)) {
          throw new PseudoError(
            `Function ${node.name} must RETURN a ${node.returnType} value.`,
            node.line
          );
        }
        ctx.scope = prev.scope;
        ctx.inProcedure = prev.inProcedure;
        ctx.inFunction = prev.inFunction;
        return;
      }
      case "Call": {
        const sym = ctx.scope.lookup(node.name);
        if (!sym) {
          throw new PseudoError(
            `There is no procedure called "${node.name}". Declare it with PROCEDURE ${node.name} before using CALL.`,
            node.line
          );
        }
        if (sym.kind === "function" || (sym.kind === "builtin" && sym.returnType)) {
          throw new PseudoError(
            `"${node.name}" is a function. Use it in an expression, for example Result ← ${node.name}(...), not CALL.`,
            node.line
          );
        }
        if (sym.kind !== "procedure") {
          throw new PseudoError(`"${node.name}" is not a procedure, so you cannot CALL it.`, node.line);
        }
        checkCallArgs(sym, node.args, node.line);
        return;
      }
      case "Return": {
        if (!ctx.inFunction) {
          throw new PseudoError("RETURN can only be used inside a FUNCTION.", node.line);
        }
        const t = exprType(node.expr);
        if (!canAssign(t, ctx.inFunction.returnType)) {
          throw new PseudoError(
            `Function ${ctx.inFunction.name} RETURNS ${ctx.inFunction.returnType}, but this RETURN gives a ${t}.`,
            node.line
          );
        }
        return;
      }
      case "OpenFile":
      case "ReadFile":
      case "WriteFile":
      case "CloseFile":
        throw fileStub(node.line);
      default:
        throw new PseudoError(`Internal error: unknown statement ${node.kind}.`, node.line);
    }
  }

  function checkCallArgs(sym, args, line) {
    const expected = sym.params || [];
    if (args.length !== expected.length) {
      throw new PseudoError(
        `"${sym.name}" expects ${expected.length} argument${expected.length === 1 ? "" : "s"}, but you passed ${args.length}.`,
        line
      );
    }
    args.forEach((arg, i) => {
      const p = expected[i];
      if (p.mode === "BYREF" && arg.kind !== "Variable" && arg.kind !== "Index") {
        throw new PseudoError(
          `Parameter "${p.name}" is BYREF, so you must pass a variable (not an expression).`,
          line
        );
      }
      const at = exprType(arg);
      if (!argCompatible(at, p.dataType)) {
        throw new PseudoError(
          `Argument ${i + 1} of ${sym.name} should be ${p.dataType === "NUMERIC" ? "INTEGER or REAL" : p.dataType}, but you passed ${at}.`,
          line
        );
      }
    });
  }

  function lvalueName(target) {
    return target.name;
  }

  function lvalueType(target, forWrite) {
    const sym = ctx.scope.lookup(target.name);
    if (!sym) throw undeclared(target.name, target.line);
    if (forWrite && (sym.kind === "const" || sym.constant)) {
      throw new PseudoError(`"${target.name}" is a CONSTANT, so you cannot change it.`, target.line);
    }
    if (target.kind === "Index") {
      if (sym.kind !== "array") {
        throw new PseudoError(`"${target.name}" is not an array, so you cannot use [...].`, target.line);
      }
      if (target.indices.length !== sym.dims) {
        throw new PseudoError(
          `"${target.name}" has ${sym.dims} dimension${sym.dims === 1 ? "" : "s"}, but you used ${target.indices.length} index${target.indices.length === 1 ? "" : "es"}.`,
          target.line
        );
      }
      for (const ix of target.indices) {
        const it = exprType(ix);
        if (it !== "INTEGER") {
          throw new PseudoError("Array indexes must be INTEGER.", target.line);
        }
      }
      return sym.dataType;
    }
    if (sym.kind === "array") {
      throw new PseudoError(`"${target.name}" is an array. Use an index, for example ${target.name}[1].`, target.line);
    }
    if (sym.kind === "procedure" || sym.kind === "function" || sym.kind === "builtin") {
      throw new PseudoError(`"${target.name}" is a ${sym.kind}, not a variable.`, target.line);
    }
    return sym.dataType;
  }

  function exprType(node) {
    switch (node.kind) {
      case "Literal":
        return node.dataType;
      case "Variable": {
        const sym = ctx.scope.lookup(node.name);
        if (!sym) throw undeclared(node.name, node.line);
        if (sym.kind === "array") {
          throw new PseudoError(`"${node.name}" is an array. Use an index, for example ${node.name}[1].`, node.line);
        }
        if (sym.kind === "procedure" || sym.kind === "function" || sym.kind === "builtin") {
          throw new PseudoError(`"${node.name}" is a ${sym.kind}. Call it with parentheses if it is a function.`, node.line);
        }
        return sym.dataType;
      }
      case "Index":
        return lvalueType(node, false);
      case "Unary": {
        const t = exprType(node.expr);
        if (node.op === "NOT") {
          if (t !== "BOOLEAN") throw new PseudoError("NOT can only be used with a BOOLEAN value.", node.line);
          return "BOOLEAN";
        }
        if (!NUMERIC.has(t)) throw new PseudoError("A minus sign can only be used with INTEGER or REAL values.", node.line);
        return t === "INTEGER" ? "INTEGER" : "REAL";
      }
      case "Binary":
        return binaryType(node);
      case "FuncCall":
        return funcCallType(node);
      default:
        throw new PseudoError(`Internal error: unknown expression ${node.kind}.`, node.line);
    }
  }

  function binaryType(node) {
    const lt = exprType(node.left);
    const rt = exprType(node.right);
    const op = node.op;
    if (op === "&") {
      if ((lt !== "STRING" && lt !== "CHAR") || (rt !== "STRING" && rt !== "CHAR")) {
        throw new PseudoError(
          "& joins STRING or CHAR values. For numbers, convert them first with NUM_TO_STRING.",
          node.line
        );
      }
      return "STRING";
    }
    if (op === "AND" || op === "OR") {
      if (lt !== "BOOLEAN" || rt !== "BOOLEAN") {
        throw new PseudoError(`${op} needs BOOLEAN values on both sides.`, node.line);
      }
      return "BOOLEAN";
    }
    if (op === "+" || op === "-" || op === "*" || op === "/") {
      if (!NUMERIC.has(lt) || !NUMERIC.has(rt)) {
        throw new PseudoError(
          `You cannot use ${op} on ${lt} and ${rt}. Arithmetic only works with INTEGER and REAL.`,
          node.line
        );
      }
      if (op === "/") return "REAL";
      if (lt === "INTEGER" && rt === "INTEGER") return "INTEGER";
      return "REAL";
    }
    if (["EQ", "NEQ", "LT", "GT", "LEQ", "GEQ"].includes(op)) {
      if (op === "EQ" || op === "NEQ") {
        if (lt === rt || (NUMERIC.has(lt) && NUMERIC.has(rt)) || (lt === "CHAR" && rt === "STRING") || (lt === "STRING" && rt === "CHAR")) {
          return "BOOLEAN";
        }
        throw new PseudoError(`You cannot compare ${lt} with ${rt} using = or <>.`, node.line);
      }
      if (!ORDERED.has(lt) || !ORDERED.has(rt)) {
        throw new PseudoError(`You cannot compare ${lt} values with <, >, <= or >=.`, node.line);
      }
      if (NUMERIC.has(lt) && NUMERIC.has(rt)) return "BOOLEAN";
      if (lt === rt) return "BOOLEAN";
      throw new PseudoError(`You cannot compare ${lt} with ${rt}.`, node.line);
    }
    throw new PseudoError(`Unknown operator ${op}.`, node.line);
  }

  function funcCallType(node) {
    if (node.name === "SUBSTRING") {
      throw new PseudoError(
        "There is no SUBSTRING function in IGCSE 2210 pseudocode. Use MID(string, start, length) instead.",
        node.line
      );
    }
    if (node.name === "EOF") throw fileStub(node.line);
    const sym = ctx.scope.lookup(node.name);
    if (!sym) {
      throw new PseudoError(
        `There is no function called "${node.name}". Check the spelling, or declare it with FUNCTION ${node.name}.`,
        node.line
      );
    }
    if (sym.kind === "procedure") {
      throw new PseudoError(
        `"${node.name}" is a procedure, so it has no return value. Use CALL ${node.name}(...) instead.`,
        node.line
      );
    }
    if (sym.kind !== "function" && sym.kind !== "builtin") {
      throw new PseudoError(`"${node.name}" is not a function.`, node.line);
    }
    checkCallArgs(sym, node.args, node.line);
    return sym.returnType;
  }

  function fileStub(line) {
    return new PseudoError(
      "File handling is not supported in the browser. OPENFILE, READFILE, WRITEFILE, CLOSEFILE and EOF cannot be used here.",
      line
    );
  }

  for (const s of ast.statements) {
    if (s.kind === "Declare" || s.kind === "Constant") checkStmt(s);
  }
  for (const s of ast.statements) {
    if (s.kind !== "Declare" && s.kind !== "Constant") checkStmt(s);
  }
  return global;
}
