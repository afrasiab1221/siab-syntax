import { PseudoError } from "./errors.js";

export const KEYWORDS = new Set([
  "DECLARE", "CONSTANT",
  "INPUT", "OUTPUT",
  "IF", "THEN", "ELSE", "ENDIF",
  "CASE", "OF", "OTHERWISE", "ENDCASE",
  "FOR", "TO", "STEP", "NEXT",
  "WHILE", "DO", "ENDWHILE",
  "REPEAT", "UNTIL",
  "PROCEDURE", "ENDPROCEDURE", "CALL", "BYREF", "BYVAL",
  "FUNCTION", "RETURNS", "RETURN", "ENDFUNCTION",
  "ARRAY",
  "INTEGER", "REAL", "CHAR", "STRING", "BOOLEAN", "DATE",
  "TRUE", "FALSE",
  "AND", "OR", "NOT",
  "OPENFILE", "READFILE", "WRITEFILE", "CLOSEFILE", "READ", "WRITE", "APPEND", "EOF"
]);

const INFIX_DIV_MOD = new Set(["DIV", "MOD"]);

export function lex(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const peek = (k = 0) => (i + k < n ? source[i + k] : "");
  const isDigit = (c) => c >= "0" && c <= "9";
  const isIdentStart = (c) => /[A-Za-z]/.test(c);
  const isIdentPart = (c) => /[A-Za-z0-9_]/.test(c);

  function advance() {
    const c = source[i++];
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  }

  function add(type, value, startLine, startCol) {
    tokens.push({ type, value, line: startLine, col: startCol });
  }

  function tryDate(startLine, startCol) {
    const slice = source.slice(i);
    const m = slice.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return false;
    const after = slice[m[0].length];
    if (after && isDigit(after)) return false;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(m[3]);
    if (d < 1 || d > 31 || mo < 1 || mo > 12) {
      throw new PseudoError(
        `Invalid DATE literal "${m[0]}". Use DD/MM/YYYY with a real calendar date.`,
        startLine
      );
    }
    for (let k = 0; k < m[0].length; k++) advance();
    add("DATE", { day: d, month: mo, year: y, text: m[0] }, startLine, startCol);
    return true;
  }

  while (i < n) {
    const c = peek();
    const startLine = line;
    const startCol = col;

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      advance();
      continue;
    }

    if (c === "/" && peek(1) === "/") {
      while (i < n && peek() !== "\n") advance();
      continue;
    }

    if (tryDate(startLine, startCol)) continue;

    if (c === "←") {
      advance();
      add("ASSIGN", "←", startLine, startCol);
      continue;
    }

    if (c === "<") {
      if (peek(1) === "-") {
        advance();
        advance();
        add("ASSIGN", "<-", startLine, startCol);
      } else if (peek(1) === ">") {
        advance();
        advance();
        add("NEQ", "<>", startLine, startCol);
      } else if (peek(1) === "=") {
        advance();
        advance();
        add("LEQ", "<=", startLine, startCol);
      } else {
        advance();
        add("LT", "<", startLine, startCol);
      }
      continue;
    }

    if (c === ">") {
      if (peek(1) === "=") {
        advance();
        advance();
        add("GEQ", ">=", startLine, startCol);
      } else {
        advance();
        add("GT", ">", startLine, startCol);
      }
      continue;
    }

    if (c === "=") {
      advance();
      add("EQ", "=", startLine, startCol);
      continue;
    }

    const singles = {
      "+": "PLUS",
      "-": "MINUS",
      "*": "STAR",
      "/": "SLASH",
      "&": "AMP",
      "(": "LPAREN",
      ")": "RPAREN",
      "[": "LBRACK",
      "]": "RBRACK",
      ",": "COMMA",
      ":": "COLON"
    };
    if (singles[c]) {
      advance();
      add(singles[c], c, startLine, startCol);
      continue;
    }

    if (c === '"') {
      advance();
      let s = "";
      while (i < n && peek() !== '"' && peek() !== "\n") s += advance();
      if (peek() !== '"') {
        throw new PseudoError('This string is missing a closing ". Strings must stay on one line.', startLine);
      }
      advance();
      add("STRING", s, startLine, startCol);
      continue;
    }

    if (c === "'") {
      advance();
      if (i >= n || peek() === "\n") {
        throw new PseudoError("This CHAR literal is empty. Write a single character in quotes, like 'A'.", startLine);
      }
      const ch = advance();
      if (peek() !== "'") {
        throw new PseudoError("CHAR literals hold exactly one character, like 'A'. For longer text use a STRING in double quotes.", startLine);
      }
      advance();
      add("CHAR", ch, startLine, startCol);
      continue;
    }

    if (isDigit(c)) {
      let num = "";
      while (isDigit(peek())) num += advance();
      if (peek() === "." && isDigit(peek(1))) {
        num += advance();
        while (isDigit(peek())) num += advance();
        add("REAL", Number(num), startLine, startCol);
      } else {
        add("INT", Number(num), startLine, startCol);
      }
      continue;
    }

    if (isIdentStart(c)) {
      let id = "";
      while (isIdentPart(peek())) id += advance();
      if (KEYWORDS.has(id)) {
        add(id, id, startLine, startCol);
      } else {
        add("IDENT", id, startLine, startCol);
      }
      continue;
    }

    throw new PseudoError(`Unexpected character "${c}".`, startLine);
  }

  tokens.push({ type: "EOF", value: "EOF", line, col });
  return tokens;
}

export { INFIX_DIV_MOD };
