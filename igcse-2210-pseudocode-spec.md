# Cambridge IGCSE 2210 Pseudocode — Complete Language Specification
### For building a compiler / interpreter (Cursor build spec)

This document specifies the **entire pseudocode language** as defined in the Cambridge IGCSE & O Level Computer Science 2210 syllabus (based on Cambridge International's official "Pseudocode Guide for Teachers," which is the exact convention Chapter 7 — Algorithm Design and Problem Solving — teaches). Treat this as the language reference for a lexer/parser/interpreter. Feed this whole file to Cursor as the spec; build the tool section by section in the order given.

---

## 1. Lexical Rules

- **Case sensitivity**: Keywords are ALWAYS UPPERCASE (`DECLARE`, `IF`, `FOR`...). Identifiers are case-sensitive but conventionally start lowercase or PascalCase; the compiler should NOT force casing on identifiers, only recognize keywords in uppercase.
- **Comments**: `//` starts a single-line comment, runs to end of line.
- **Statement separation**: One statement per line. No semicolons.
- **Identifiers**: Start with a letter, then letters/digits/underscore. No reserved words as identifiers.
- **Whitespace/indentation**: Not semantically significant (unlike Python) but used for readability in nested blocks. The compiler should tolerate any indentation.
- **String literals**: Enclosed in double quotes `"like this"`.
- **Char literals**: Enclosed in single quotes `'A'`.
- **Numeric literals**: Integers as `123`, Reals as `1.23`.
- **Boolean literals**: `TRUE`, `FALSE`.

---

## 2. Data Types

| Type | Description | Example literal |
|---|---|---|
| `INTEGER` | Whole number | `42` |
| `REAL` | Floating point | `3.14` |
| `CHAR` | Single character | `'A'` |
| `STRING` | Sequence of characters | `"Hello"` |
| `BOOLEAN` | TRUE/FALSE | `TRUE` |
| `DATE` | Date value | `01/01/2024` (format DD/MM/YYYY) |

**Type rules the interpreter must enforce:**
- Assignment must match declared type (or be a valid implicit numeric widening: INTEGER → REAL).
- Arithmetic on CHAR/STRING is invalid except via string functions.
- Comparisons (`<`, `>`, `<=`, `>=`) are valid on INTEGER, REAL, CHAR, STRING (lexicographic), DATE.

---

## 3. Variable Declaration

```
DECLARE <identifier> : <data type>
```
Examples:
```
DECLARE Counter : INTEGER
DECLARE Price : REAL
DECLARE Initial : CHAR
DECLARE Name : STRING
DECLARE Flag : BOOLEAN
```

**Constants:**
```
CONSTANT <identifier> = <value>
```
Example: `CONSTANT HourlyRate = 6.50`

---

## 4. Assignment

```
<identifier> ← <expression>
```
Note: The official symbol is a left-arrow `←`. Since most keyboards/editors can't type `←` easily, the compiler MUST also accept `<-` as an equivalent token (very common substitution in practice, including in Cursor-authored tools). Treat `←` and `<-` as the same ASSIGN token.

Example:
```
Total ← Total + Price
Name ← "Ahsan"
```

---

## 5. Operators

**Arithmetic**: `+` `-` `*` `/`
**Relational**: `>` `<` `>=` `<=` `=` `<>`
**Logical**: `AND` `OR` `NOT`
**String concatenation**: `&`

Note: `DIV` and `MOD` are **not** infix operators in this convention — they are called as **library routines**, e.g. `DIV(10,3)` not `10 DIV 3`. See §11a (Numeric Library Routines) below. The compiler should tokenize `DIV`, `MOD`, `ROUND`, `RANDOM` as function identifiers, not operators.

Operator precedence (highest to lowest):
1. `NOT`
2. `*` `/`
3. `+` `-` `&`
4. `>` `<` `>=` `<=` `=` `<>`
5. `AND`
6. `OR`

Parentheses `()` override precedence as usual.

---

## 6. Input / Output

```
INPUT <identifier>
OUTPUT <expression> {, <expression>}
```
Example:
```
INPUT Age
OUTPUT "Your age is ", Age
```
`OUTPUT` with multiple comma-separated expressions concatenates them (with implicit type-to-string conversion) in the output line.

---

## 7. Selection (Branching)

**IF statement:**
```
IF <condition>
   THEN
      <statements>
   ELSE
      <statements>
ENDIF
```
- `ELSE` block optional.
- Nested IFs allowed.

**CASE statement:**
```
CASE OF <identifier>
   <value 1> : <statement>
   <value 2> : <statement>
   OTHERWISE <statement>
ENDCASE
```
- Ranges allowed: `4 TO 6 : <statement>`
- `OTHERWISE` is optional, acts as default.

---

## 8. Iteration (Loops)

**Count-controlled (FOR):**
```
FOR <identifier> ← <start> TO <end>
   <statements>
NEXT <identifier>
```
Optional step:
```
FOR <identifier> ← <start> TO <end> STEP <step>
   <statements>
NEXT <identifier>
```

**Pre-condition (WHILE) — condition checked before each iteration, may run 0 times:**
```
WHILE <condition> DO
   <statements>
ENDWHILE
```

**Post-condition (REPEAT) — condition checked after each iteration, runs at least once, loop continues UNTIL condition is TRUE:**
```
REPEAT
   <statements>
UNTIL <condition>
```

---

## 9. Arrays

**1D array declaration:**
```
DECLARE <identifier> : ARRAY[<lower>:<upper>] OF <data type>
```
Example: `DECLARE Scores : ARRAY[1:10] OF INTEGER`

**2D array declaration:**
```
DECLARE <identifier> : ARRAY[<lower1>:<upper1>, <lower2>:<upper2>] OF <data type>
```
Example: `DECLARE Grid : ARRAY[1:5, 1:5] OF CHAR`

**Indexing:** `Scores[3]`, `Grid[2,4]` — 1-indexed by convention (lower bound as declared, commonly starts at 1).

---

## 10. Procedures and Functions

**Procedure (no return value):**
```
PROCEDURE <name>(<param1> : <type>, <param2> : <type>)
   <statements>
ENDPROCEDURE
```
Call: `CALL <name>(<arg1>, <arg2>)`

**Function (returns a value):**
```
FUNCTION <name>(<param1> : <type>) RETURNS <data type>
   <statements>
   RETURN <expression>
ENDFUNCTION
```
Call: used directly in an expression, e.g. `Result ← Double(5)`

**Parameter passing:** default is BY VALUE. BY REFERENCE explicitly marked:
```
PROCEDURE Example(BYREF X : INTEGER)
```

---

## 11. String Handling Functions (built-ins the interpreter must implement)

| Function | Purpose | Example |
|---|---|---|
| `LENGTH(str)` | Returns number of characters | `LENGTH("Hello")` → 5 |
| `MID(str, start, length)` | Extracts part of string | `MID("Hello",1,3)` → "Hel" |
| `LEFT(str, n)` | First n characters | `LEFT("Hello",2)` → "He" |
| `RIGHT(str, n)` | Last n characters | `RIGHT("Hello",2)` → "lo" |
| `UCASE(str)` | Convert to uppercase | `UCASE("hi")` → "HI" |
| `LCASE(str)` | Convert to lowercase | `LCASE("HI")` → "hi" |
| `NUM_TO_STRING(num)` | Number → string | |
| `STRING_TO_NUM(str)` | String → number | |

---

## 11a. Numeric Library Routines (built-ins the interpreter must implement)

Called as functions, not infix operators — this is the confirmed O-Level 2210 Chapter 8 convention:

| Function | Purpose | Example |
|---|---|---|
| `MOD(x, y)` | Returns the remainder of x divided by y | `MOD(10,3)` → 1 |
| `DIV(x, y)` | Returns the quotient (whole number part) of x divided by y | `DIV(10,3)` → 3 |
| `ROUND(x, places)` | Rounds x to the given number of decimal places | `ROUND(6.97354, 2)` → 6.97 |
| `RANDOM()` | Returns a random real number between 0 and 1 inclusive | `RANDOM()` → e.g. 0.634 |

All four take numeric arguments and return a numeric result (`MOD`/`DIV` return INTEGER, `ROUND` returns REAL, `RANDOM()` returns REAL). None of them belong in the string-handling table above.

---

## 12. File Handling

```
OPENFILE <filename> FOR <READ | WRITE | APPEND>
READFILE <filename>, <identifier>
WRITEFILE <filename>, <expression>
EOF(<filename>)      // returns BOOLEAN, TRUE at end of file
CLOSEFILE <filename>
```
Typical read loop:
```
OPENFILE "data.txt" FOR READ
WHILE NOT EOF("data.txt") DO
   READFILE "data.txt", Line
   OUTPUT Line
ENDWHILE
CLOSEFILE "data.txt"
```

---

## 13. Complete Reserved Keyword List

```
DECLARE CONSTANT
INPUT OUTPUT
IF THEN ELSE ENDIF
CASE OF OTHERWISE ENDCASE
FOR TO STEP NEXT
WHILE DO ENDWHILE
REPEAT UNTIL
PROCEDURE ENDPROCEDURE CALL BYREF BYVAL
FUNCTION RETURNS RETURN ENDFUNCTION
ARRAY OF
INTEGER REAL CHAR STRING BOOLEAN DATE
TRUE FALSE
AND OR NOT
OPENFILE READFILE WRITEFILE CLOSEFILE READ WRITE APPEND EOF
```

**Built-in library routine identifiers** (functions, not operators — tokenize as identifiers that resolve to built-ins, per §11a): `MOD` `DIV` `ROUND` `RANDOM`

---

## 14. Build Order Recommendation for Cursor

1. **Lexer/Tokenizer** — tokenize keywords (§13), identifiers, literals (§1–2), operators (§5), and `←`/`<-`.
2. **Parser** — build an AST covering: declarations (§3), assignment (§4), I/O (§6), selection (§7), iteration (§8), arrays (§9), procedures/functions (§10).
3. **Symbol table** — track declared identifiers, types, scope (global vs. procedure/function local scope), and constants.
4. **Type checker** — enforce §2's type rules at assignment, expression evaluation, and function return points.
5. **Interpreter/evaluator** — walk the AST, maintain a runtime environment (variable bindings + call stack for procedures/functions), implement built-ins (§11–12).
6. **Error handling** — should report: undeclared variable use, type mismatch, array index out of bounds, missing ENDIF/ENDWHILE/etc. (unbalanced block), division by zero, calling undefined procedure/function with wrong arg count.
7. **REPL/CLI runner** — accept a `.pseudo` file, run it, print OUTPUT statements to console, prompt for INPUT statements interactively.

---

## 15. Worked Example (use as a test case for the finished compiler)

```
DECLARE Total : INTEGER
DECLARE Count : INTEGER
DECLARE Mark : INTEGER
DECLARE Average : REAL

Total ← 0
Count ← 0

FOR Count ← 1 TO 5
   OUTPUT "Enter mark ", Count
   INPUT Mark
   Total ← Total + Mark
NEXT Count

Average ← Total / 5
OUTPUT "Average mark is ", Average

IF Average >= 50
   THEN
      OUTPUT "Pass"
   ELSE
      OUTPUT "Fail"
ENDIF
```

Expected behavior: prompts 5 times for a mark, sums them, computes and prints the average as a REAL, then branches on pass/fail.

---

**Note on scope of this spec:** This covers the full IGCSE 2210 pseudocode convention as used across the syllabus (Ch. 7 algorithm design, Ch. 8 programming). It does not include exam-specific flowchart symbols (those are a separate visual notation, not part of the text-based pseudocode language, so irrelevant to a compiler).
