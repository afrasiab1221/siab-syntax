import { PseudoError, StopSignal } from "./errors.js";
import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import { typecheck } from "./typecheck.js";
import { interpret } from "./interpreter.js";

export async function run(source, io) {
  try {
    const tokens = lex(source);
    const ast = parse(tokens);
    typecheck(ast);
    await interpret(ast, io);
    if (!io.shouldStop()) io.ok("Finished.");
  } catch (err) {
    if (err instanceof StopSignal) {
      io.info("Stopped.");
      return;
    }
    if (err instanceof PseudoError) {
      io.error(err.studentMessage || err.message);
      return;
    }
    console.error(err);
    io.error("Something went wrong while running this program. Check your syntax and try again.");
  }
}

export { lex, parse, typecheck };
