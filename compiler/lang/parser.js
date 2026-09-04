import { PseudoError } from "./errors.js";

const DATA_TYPES = new Set(["INTEGER", "REAL", "CHAR", "STRING", "BOOLEAN", "DATE"]);
const REL_OPS = new Set(["EQ", "NEQ", "LT", "GT", "LEQ", "GEQ"]);
const CASE_STARTERS = new Set(["INT", "REAL", "STRING", "CHAR", "DATE", "TRUE", "FALSE", "MINUS"]);
const HINT_KEYWORDS = [
  "DECLARE", "CONSTANT", "INPUT", "OUTPUT", "IF", "THEN", "ELSE", "ENDIF",
  "CASE", "FOR", "WHILE", "REPEAT", "PROCEDURE", "FUNCTION", "CALL", "RETURN"
];

export function parse(tokens) {
  let pos = 0;

  function peek(offset = 0) {
    return tokens[Math.min(pos + offset, tokens.length - 1)];
  }
  function at(type, offset = 0) {
    return peek(offset).type === type;
  }
  function check(...types) {
    return types.includes(peek().type);
  }
  function advance() {
    const t = peek();
    if (t.type !== "EOF") pos++;
    return t;
  }
  function match(...types) {
    if (check(...types)) return advance();
    return null;
  }
  function expect(type, message) {
    if (at(type)) return advance();
    const t = peek();
    throw new PseudoError(message || `Expected ${type} but found ${describe(t)}.`, t.line);
  }
  function describe(t) {
    if (t.type === "IDENT") return `the name "${t.value}"`;
    if (t.type === "EOF") return "the end of the program";
    if (t.type === "INT" || t.type === "REAL") return `the number ${t.value}`;
    if (t.type === "STRING") return `the string "${t.value}"`;
    return t.value || t.type;
  }
  function loc() {
    return peek().line;
  }

  function checkInfixDivMod() {
    const t = peek();
    if (t.type === "IDENT" && (t.value === "DIV" || t.value === "MOD")) {
      throw new PseudoError(
        `${t.value} is a function, not an operator. Write ${t.value}(a, b) instead of a ${t.value} b.`,
        t.line
      );
    }
  }

  function parseProgram() {
    const statements = [];
    while (!at("EOF")) statements.push(parseStatement());
    return { kind: "Program", statements, line: 1 };
  }

  function parseBlock(enders, startLine, missing) {
    const statements = [];
    while (!check(...enders) && !at("EOF")) {
      statements.push(parseStatement());
    }
    if (at("EOF")) {
      throw new PseudoError(
        `${missing} (this block started on line ${startLine}).`,
        startLine
      );
    }
    return statements;
  }

  function parseStatement() {
    const t = peek();
    switch (t.type) {
      case "DECLARE": return parseDeclare();
      case "CONSTANT": return parseConstant();
      case "INPUT": return parseInput();
      case "OUTPUT": return parseOutput();
      case "IF": return parseIf();
      case "CASE": return parseCase();
      case "FOR": return parseFor();
      case "WHILE": return parseWhile();
      case "REPEAT": return parseRepeat();
      case "PROCEDURE": return parseProcedure();
      case "FUNCTION": return parseFunction();
      case "CALL": return parseCallStmt();
      case "RETURN": return parseReturn();
      case "OPENFILE": return parseOpenFile();
      case "READFILE": return parseReadFile();
      case "WRITEFILE": return parseWriteFile();
      case "CLOSEFILE": return parseCloseFile();
      case "IDENT": return parseAssignOrUnknown();
      default: {
        if (t.type === "EOF") {
          throw new PseudoError("Unexpected end of program.", t.line);
        }
        const hint = hintWrongCase(t);
        throw new PseudoError(
          hint || `I don't understand ${describe(t)} here. This line should be a statement such as DECLARE, INPUT, OUTPUT, or an assignment.`,
          t.line
        );
      }
    }
  }

  function hintWrongCase(t) {
    if (t.type !== "IDENT") return null;
    const upper = String(t.value).toUpperCase();
    if (HINT_KEYWORDS.includes(upper) && t.value !== upper) {
      return `"${t.value}" looks like the keyword ${upper}, but keywords must be fully UPPERCASE.`;
    }
    return null;
  }

  function parseDataType() {
    const t = peek();
    if (DATA_TYPES.has(t.type)) return advance().type;
    throw new PseudoError(
      `Expected a data type (INTEGER, REAL, CHAR, STRING, BOOLEAN or DATE) but found ${describe(t)}.`,
      t.line
    );
  }

  function parseDeclare() {
    const start = expect("DECLARE");
    const nameTok = expect("IDENT", "DECLARE needs a variable name after it.");
    expect("COLON", `Put a colon before the type: DECLARE ${nameTok.value} : INTEGER`);
    if (match("ARRAY")) {
      expect("LBRACK", "Array bounds go in square brackets, like ARRAY[1:10].");
      const dims = [];
      do {
        const lower = parseExpr();
        expect("COLON", "Array bounds are written lower:upper, for example 1:10.");
        const upper = parseExpr();
        dims.push({ lower, upper });
      } while (match("COMMA"));
      expect("RBRACK", "This ARRAY declaration is missing a closing ].");
      expect("OF", "Write OF and then the element type, for example ARRAY[1:10] OF INTEGER.");
      const elemType = parseDataType();
      if (dims.length > 2) {
        throw new PseudoError("Only 1D and 2D arrays are supported.", start.line);
      }
      return { kind: "Declare", name: nameTok.value, dataType: elemType, dims, line: start.line };
    }
    const dataType = parseDataType();
    return { kind: "Declare", name: nameTok.value, dataType, dims: null, line: start.line };
  }

  function parseConstant() {
    const start = expect("CONSTANT");
    const nameTok = expect("IDENT", "CONSTANT needs a name, for example CONSTANT HourlyRate = 6.50");
    expect("EQ", "Constants use =, not ←. Write CONSTANT Name = value.");
    const value = parseExpr();
    return { kind: "Constant", name: nameTok.value, value, line: start.line };
  }

  function parseLValueFromIdent(nameTok) {
    if (match("LBRACK")) {
      const indices = [parseExpr()];
      while (match("COMMA")) indices.push(parseExpr());
      expect("RBRACK", `Array index for ${nameTok.value} is missing ].`);
      return { kind: "Index", name: nameTok.value, indices, line: nameTok.line };
    }
    return { kind: "Variable", name: nameTok.value, line: nameTok.line };
  }

  function parseAssignOrUnknown() {
    const nameTok = expect("IDENT");
    if (at("LPAREN")) {
      throw new PseudoError(
        `To run a procedure write CALL ${nameTok.value}(...). Functions must be used in an expression, for example Result ← ${nameTok.value}(5).`,
        nameTok.line
      );
    }
    const target = parseLValueFromIdent(nameTok);
    if (!at("ASSIGN")) {
      const hint = hintWrongCase(nameTok);
      throw new PseudoError(
        hint || `I expected ← (or <-) after "${nameTok.value}" to assign a value.`,
        nameTok.line
      );
    }
    const op = expect("ASSIGN");
    const expr = parseExpr();
    return { kind: "Assign", target, expr, line: op.line };
  }

  function parseInput() {
    const start = expect("INPUT");
    const nameTok = expect("IDENT", "INPUT needs a variable name, for example INPUT Age.");
    const target = parseLValueFromIdent(nameTok);
    return { kind: "Input", target, line: start.line };
  }

  function parseOutput() {
    const start = expect("OUTPUT");
    const exprs = [parseExpr()];
    while (match("COMMA")) exprs.push(parseExpr());
    return { kind: "Output", exprs, line: start.line };
  }

  function parseIf() {
    const start = expect("IF");
    const condition = parseExpr();
    expect("THEN", `This IF (line ${start.line}) needs THEN after the condition.`);
    const thenBlock = parseBlock(["ELSE", "ENDIF"], start.line, "This IF is missing ENDIF");
    let elseBlock = null;
    if (match("ELSE")) {
      elseBlock = parseBlock(["ENDIF"], start.line, "This IF is missing ENDIF");
    }
    expect("ENDIF", `This IF (line ${start.line}) is missing ENDIF.`);
    return { kind: "If", condition, thenBlock, elseBlock, line: start.line };
  }

  function isCaseLabel() {
    let i = 0;
    if (peek(i).type === "MINUS" && peek(i + 1).type === "INT") i += 2;
    else if (CASE_STARTERS.has(peek(i).type) && peek(i).type !== "MINUS") i += 1;
    else return false;
    if (peek(i).type === "TO") {
      i += 1;
      if (peek(i).type === "MINUS" && peek(i + 1).type === "INT") i += 2;
      else if (CASE_STARTERS.has(peek(i).type) && peek(i).type !== "MINUS") i += 1;
      else return false;
    }
    return peek(i).type === "COLON";
  }

  function parseCaseValue() {
    const t = peek();
    if (match("TRUE")) return { kind: "Literal", dataType: "BOOLEAN", value: true, line: t.line };
    if (match("FALSE")) return { kind: "Literal", dataType: "BOOLEAN", value: false, line: t.line };
    if (match("MINUS") && at("INT")) {
      const n = advance();
      return { kind: "Literal", dataType: "INTEGER", value: -n.value, line: t.line };
    }
    if (t.type === "INT") {
      advance();
      return { kind: "Literal", dataType: "INTEGER", value: t.value, line: t.line };
    }
    if (t.type === "REAL") {
      advance();
      return { kind: "Literal", dataType: "REAL", value: t.value, line: t.line };
    }
    if (t.type === "STRING") {
      advance();
      return { kind: "Literal", dataType: "STRING", value: t.value, line: t.line };
    }
    if (t.type === "CHAR") {
      advance();
      return { kind: "Literal", dataType: "CHAR", value: t.value, line: t.line };
    }
    if (t.type === "DATE") {
      advance();
      return { kind: "Literal", dataType: "DATE", value: t.value, line: t.line };
    }
    throw new PseudoError("CASE labels must be values such as 1, 'A', \"Hi\" or TRUE.", t.line);
  }

  function parseCase() {
    const start = expect("CASE");
    expect("OF", "Write CASE OF followed by the variable you are testing.");
    const nameTok = expect("IDENT", "CASE OF needs a variable name.");
    const branches = [];
    let otherwise = null;
    while (!at("ENDCASE") && !at("EOF")) {
      if (match("OTHERWISE")) {
        match("COLON");
        otherwise = [];
        while (!at("ENDCASE") && !at("EOF") && !isCaseLabel() && !at("OTHERWISE")) {
          otherwise.push(parseStatement());
        }
        break;
      }
      if (!isCaseLabel()) {
        throw new PseudoError(
          `Unexpected ${describe(peek())} inside CASE. Add a value label (for example 1 :), OTHERWISE, or ENDCASE.`,
          peek().line
        );
      }
      const from = parseCaseValue();
      let to = null;
      if (match("TO")) to = parseCaseValue();
      expect("COLON", "Put a colon after a CASE value, for example 1 : OUTPUT \"one\".");
      const statements = [];
      while (!at("ENDCASE") && !at("EOF") && !at("OTHERWISE") && !isCaseLabel()) {
        statements.push(parseStatement());
      }
      branches.push({ from, to, statements });
    }
    expect("ENDCASE", `This CASE (line ${start.line}) is missing ENDCASE.`);
    return {
      kind: "Case",
      name: nameTok.value,
      branches,
      otherwise,
      line: start.line
    };
  }

  function parseFor() {
    const start = expect("FOR");
    const nameTok = expect("IDENT", "FOR needs a counter variable, for example FOR i ← 1 TO 10.");
    expect("ASSIGN", `Write FOR ${nameTok.value} ← start TO end.`);
    const startExpr = parseExpr();
    expect("TO", `This FOR loop needs TO, for example FOR ${nameTok.value} ← 1 TO 10.`);
    const endExpr = parseExpr();
    let step = null;
    if (match("STEP")) step = parseExpr();
    const body = parseBlock(["NEXT"], start.line, "This FOR loop is missing NEXT");
    expect("NEXT", `This FOR loop (line ${start.line}) is missing NEXT ${nameTok.value}.`);
    const nextTok = expect("IDENT", `NEXT should be followed by the loop variable ${nameTok.value}.`);
    if (nextTok.value !== nameTok.value) {
      throw new PseudoError(
        `NEXT ${nextTok.value} does not match FOR ${nameTok.value}. Use NEXT ${nameTok.value}.`,
        nextTok.line
      );
    }
    return {
      kind: "For",
      name: nameTok.value,
      start: startExpr,
      end: endExpr,
      step,
      body,
      line: start.line
    };
  }

  function parseWhile() {
    const start = expect("WHILE");
    const condition = parseExpr();
    expect("DO", `This WHILE (line ${start.line}) needs DO after the condition.`);
    const body = parseBlock(["ENDWHILE"], start.line, "This WHILE loop is missing ENDWHILE");
    expect("ENDWHILE", `This WHILE loop (line ${start.line}) is missing ENDWHILE.`);
    return { kind: "While", condition, body, line: start.line };
  }

  function parseRepeat() {
    const start = expect("REPEAT");
    const body = parseBlock(["UNTIL"], start.line, "This REPEAT loop is missing UNTIL");
    expect("UNTIL", `This REPEAT loop (line ${start.line}) is missing UNTIL.`);
    const condition = parseExpr();
    return { kind: "Repeat", body, condition, line: start.line };
  }

  function parseParams() {
    const params = [];
    if (!match("LPAREN")) return params;
    if (match("RPAREN")) return params;
    do {
      const line = loc();
      let mode = "BYVAL";
      if (match("BYREF")) mode = "BYREF";
      else match("BYVAL");
      const nameTok = expect("IDENT", "Each parameter needs a name.");
      expect("COLON", `Write the parameter type after a colon: ${nameTok.value} : INTEGER`);
      const dataType = parseDataType();
      params.push({ name: nameTok.value, dataType, mode, line });
    } while (match("COMMA"));
    expect("RPAREN", "This parameter list is missing a closing ).");
    return params;
  }

  function parseProcedure() {
    const start = expect("PROCEDURE");
    const nameTok = expect("IDENT", "PROCEDURE needs a name.");
    const params = parseParams();
    const body = parseBlock(["ENDPROCEDURE"], start.line, "This PROCEDURE is missing ENDPROCEDURE");
    expect("ENDPROCEDURE", `This PROCEDURE (line ${start.line}) is missing ENDPROCEDURE.`);
    return { kind: "Procedure", name: nameTok.value, params, body, line: start.line };
  }

  function parseFunction() {
    const start = expect("FUNCTION");
    const nameTok = expect("IDENT", "FUNCTION needs a name.");
    const params = parseParams();
    expect("RETURNS", `This FUNCTION needs RETURNS <type>, for example RETURNS INTEGER.`);
    const returnType = parseDataType();
    const body = parseBlock(["ENDFUNCTION"], start.line, "This FUNCTION is missing ENDFUNCTION");
    expect("ENDFUNCTION", `This FUNCTION (line ${start.line}) is missing ENDFUNCTION.`);
    return { kind: "Function", name: nameTok.value, params, returnType, body, line: start.line };
  }

  function parseCallStmt() {
    const start = expect("CALL");
    const nameTok = expect("IDENT", "CALL needs the procedure name.");
    const args = [];
    if (match("LPAREN")) {
      if (!match("RPAREN")) {
        do args.push(parseExpr());
        while (match("COMMA"));
        expect("RPAREN", `CALL ${nameTok.value} is missing a closing ).`);
      }
    }
    return { kind: "Call", name: nameTok.value, args, line: start.line };
  }

  function parseReturn() {
    const start = expect("RETURN");
    const expr = parseExpr();
    return { kind: "Return", expr, line: start.line };
  }

  function parseFileName() {
    if (at("STRING") || at("IDENT")) {
      return parsePrimary();
    }
    throw new PseudoError("Expected a file name (a string or a variable).", peek().line);
  }

  function parseOpenFile() {
    const start = expect("OPENFILE");
    const filename = parseFileName();
    expect("FOR", 'Write OPENFILE "name.txt" FOR READ, WRITE or APPEND.');
    const modeTok = match("READ") || match("WRITE") || match("APPEND");
    if (!modeTok) {
      throw new PseudoError("File mode must be READ, WRITE or APPEND.", peek().line);
    }
    return { kind: "OpenFile", filename, mode: modeTok.type, line: start.line };
  }

  function parseReadFile() {
    const start = expect("READFILE");
    const filename = parseFileName();
    expect("COMMA", "READFILE needs a comma then the variable to store the line.");
    const nameTok = expect("IDENT", "READFILE needs a variable name after the comma.");
    const target = parseLValueFromIdent(nameTok);
    return { kind: "ReadFile", filename, target, line: start.line };
  }

  function parseWriteFile() {
    const start = expect("WRITEFILE");
    const filename = parseFileName();
    expect("COMMA", "WRITEFILE needs a comma then the value to write.");
    const expr = parseExpr();
    return { kind: "WriteFile", filename, expr, line: start.line };
  }

  function parseCloseFile() {
    const start = expect("CLOSEFILE");
    const filename = parseFileName();
    return { kind: "CloseFile", filename, line: start.line };
  }

  function parseExpr() {
    const node = parseOr();
    checkInfixDivMod();
    return node;
  }

  function parseOr() {
    let left = parseAnd();
    while (match("OR")) {
      const op = tokens[pos - 1];
      const right = parseAnd();
      left = { kind: "Binary", op: "OR", left, right, line: op.line };
    }
    return left;
  }

  function parseAnd() {
    let left = parseRel();
    while (match("AND")) {
      const op = tokens[pos - 1];
      const right = parseRel();
      left = { kind: "Binary", op: "AND", left, right, line: op.line };
    }
    return left;
  }

  function parseRel() {
    let left = parseAdd();
    if (check(...REL_OPS)) {
      const op = advance();
      const right = parseAdd();
      left = { kind: "Binary", op: op.type, left, right, line: op.line };
    }
    return left;
  }

  function parseAdd() {
    let left = parseMul();
    while (check("PLUS", "MINUS", "AMP")) {
      const op = advance();
      const right = parseMul();
      const name = op.type === "PLUS" ? "+" : op.type === "MINUS" ? "-" : "&";
      left = { kind: "Binary", op: name, left, right, line: op.line };
    }
    return left;
  }

  function parseMul() {
    let left = parseUnary();
    while (check("STAR", "SLASH")) {
      const op = advance();
      const right = parseUnary();
      left = { kind: "Binary", op: op.type === "STAR" ? "*" : "/", left, right, line: op.line };
    }
    checkInfixDivMod();
    return left;
  }

  function parseUnary() {
    if (match("NOT")) {
      const op = tokens[pos - 1];
      return { kind: "Unary", op: "NOT", expr: parseUnary(), line: op.line };
    }
    if (match("MINUS")) {
      const op = tokens[pos - 1];
      return { kind: "Unary", op: "-", expr: parseUnary(), line: op.line };
    }
    if (match("PLUS")) return parseUnary();
    return parsePrimary();
  }

  function parseArgList() {
    const args = [];
    if (match("RPAREN")) return args;
    do args.push(parseExpr());
    while (match("COMMA"));
    expect("RPAREN", "This function call is missing a closing ).");
    return args;
  }

  function parsePrimary() {
    const t = peek();
    if (match("TRUE")) return { kind: "Literal", dataType: "BOOLEAN", value: true, line: t.line };
    if (match("FALSE")) return { kind: "Literal", dataType: "BOOLEAN", value: false, line: t.line };
    if (match("INT")) return { kind: "Literal", dataType: "INTEGER", value: t.value, line: t.line };
    if (match("REAL")) return { kind: "Literal", dataType: "REAL", value: t.value, line: t.line };
    if (match("STRING")) return { kind: "Literal", dataType: "STRING", value: t.value, line: t.line };
    if (match("CHAR")) return { kind: "Literal", dataType: "CHAR", value: t.value, line: t.line };
    if (match("DATE")) return { kind: "Literal", dataType: "DATE", value: t.value, line: t.line };

    if (match("EOF")) {
      expect("LPAREN", "EOF is used as EOF(filename). File handling is not supported in the browser.");
      const args = parseArgList();
      return { kind: "FuncCall", name: "EOF", args, line: t.line };
    }

    if (match("IDENT")) {
      const name = t.value;
      if (match("LPAREN")) {
        const args = parseArgList();
        return { kind: "FuncCall", name, args, line: t.line };
      }
      if (match("LBRACK")) {
        const indices = [parseExpr()];
        while (match("COMMA")) indices.push(parseExpr());
        expect("RBRACK", `Array index for ${name} is missing ].`);
        return { kind: "Index", name, indices, line: t.line };
      }
      return { kind: "Variable", name, line: t.line };
    }

    if (match("LPAREN")) {
      const expr = parseExpr();
      expect("RPAREN", "This opening ( has no matching ).");
      return expr;
    }

    throw new PseudoError(`I expected a value or an expression, but found ${describe(t)}.`, t.line);
  }

  const ast = parseProgram();
  return ast;
}
