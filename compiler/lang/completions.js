import { KEYWORDS } from "./lexer.js";
import { BUILTIN_NAMES } from "./builtins.js";

export const COMPLETIONS = Array.from(new Set([...KEYWORDS, ...BUILTIN_NAMES])).sort();
