export const EXAMPLES = [
  {
    id: "marks",
    title: "Marks average (spec §15)",
    code: `DECLARE Total : INTEGER
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
`
  },
  {
    id: "forloop",
    title: "FOR loop — times table",
    code: `DECLARE i : INTEGER
DECLARE n : INTEGER

n ← 7
OUTPUT "Times table for ", n
OUTPUT ""

FOR i ← 1 TO 10
   OUTPUT n, " x ", i, " = ", n * i
NEXT i
`
  },
  {
    id: "arrays",
    title: "Arrays — highest score",
    code: `DECLARE Scores : ARRAY[1:5] OF INTEGER
DECLARE i : INTEGER
DECLARE Highest : INTEGER
DECLARE Total : INTEGER

Scores[1] ← 67
Scores[2] ← 84
Scores[3] ← 51
Scores[4] ← 90
Scores[5] ← 73

Highest ← Scores[1]
Total ← 0

FOR i ← 1 TO 5
   OUTPUT "Score ", i, ": ", Scores[i]
   Total ← Total + Scores[i]
   IF Scores[i] > Highest
      THEN
         Highest ← Scores[i]
   ENDIF
NEXT i

OUTPUT "Highest score is ", Highest
OUTPUT "Total is ", Total
`
  },
  {
    id: "routines",
    title: "Procedure and function",
    code: `FUNCTION Square(n : INTEGER) RETURNS INTEGER
   RETURN n * n
ENDFUNCTION

PROCEDURE Double(BYREF x : INTEGER)
   x ← x * 2
ENDPROCEDURE

DECLARE a : INTEGER
DECLARE b : INTEGER

a ← 5
b ← Square(a)
OUTPUT "Square of ", a, " is ", b

CALL Double(a)
OUTPUT "After Double, a is ", a
OUTPUT "DIV(10, 3) = ", DIV(10, 3)
OUTPUT "MOD(10, 3) = ", MOD(10, 3)
OUTPUT "MID of Hello = ", MID("Hello", 1, 3)
`
  }
];
