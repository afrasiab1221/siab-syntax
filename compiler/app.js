import { EXAMPLES } from "./examples.js"
import { run } from "./lang/run.js"
import { KEYWORDS } from "./lang/lexer.js"
import { BUILTIN_NAMES } from "./lang/builtins.js"
import { attachAutocomplete } from "./autocomplete.js"

const codeInput = document.getElementById("codeInput")
const exampleSelect = document.getElementById("exampleSelect")
const consoleEl = document.getElementById("console")
const runBtn = document.getElementById("runBtn")
const stopBtn = document.getElementById("stopBtn")
const clearBtn = document.getElementById("clearBtn")
const themeBtn = document.getElementById("themeBtn")
const hamburger = document.getElementById("hamburger")
const navLinks = document.getElementById("navLinks")
const root = document.documentElement

let cm = null
let stopped = false
let running = false
let pendingInput = null

document.getElementById("year").textContent = new Date().getFullYear()
if (matchMedia("(prefers-color-scheme: dark)").matches) root.dataset.theme = "dark"

themeBtn.addEventListener("click", (e) => {
  e.preventDefault()
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark"
})

hamburger.addEventListener("click", (e) => {
  e.preventDefault()
  navLinks.classList.toggle("open")
})

navLinks.querySelectorAll("a").forEach((a) => {
  a.addEventListener("click", () => navLinks.classList.remove("open"))
})

document.getElementById("compilerNav").addEventListener("click", (e) => {
  e.preventDefault()
})

EXAMPLES.forEach((ex) => {
  const opt = document.createElement("option")
  opt.value = ex.id
  opt.textContent = ex.title
  exampleSelect.appendChild(opt)
})

codeInput.value = EXAMPLES[0].code

function getCode() {
  return cm ? cm.getValue() : codeInput.value
}

function setCode(text) {
  if (cm) cm.setValue(text)
  else codeInput.value = text
}

exampleSelect.addEventListener("change", (e) => {
  e.preventDefault()
  const ex = EXAMPLES.find((item) => item.id === exampleSelect.value)
  if (ex) setCode(ex.code)
})

function definePseudoMode() {
  window.CodeMirror.defineMode("pseudocode", () => ({
    token(stream) {
      if (stream.match(/\/\/.*/)) return "comment"
      if (stream.peek() === '"') {
        stream.next()
        while (!stream.eol()) {
          if (stream.next() === '"') break
        }
        return "string"
      }
      if (stream.peek() === "'") {
        stream.next()
        if (!stream.eol()) stream.next()
        if (stream.peek() === "'") stream.next()
        return "string"
      }
      if (stream.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) return "number"
      if (stream.match(/\d+\.\d+/) || stream.match(/\d+/)) return "number"
      if (stream.match(/←|<-|<>|<=|>=/) || stream.match(/[+\-*/&=<>()[\],:]/)) return "operator"
      if (stream.match(/[A-Za-z][A-Za-z0-9_]*/)) {
        const word = stream.current()
        if (KEYWORDS.has(word)) return "keyword"
        if (BUILTIN_NAMES.has(word)) return "atom"
        return "variable"
      }
      stream.next()
      return null
    }
  }))
}

if (window.CodeMirror) {
  definePseudoMode()
  cm = window.CodeMirror.fromTextArea(codeInput, {
    lineNumbers: true,
    lineWrapping: true,
    indentUnit: 3,
    tabSize: 3,
    indentWithTabs: false,
    mode: "pseudocode",
    extraKeys: {
      "Ctrl-Enter": () => { runProgram(); return false },
      "Cmd-Enter": () => { runProgram(); return false }
    }
  })
  const hints = attachAutocomplete(cm)
  cm.setOption("extraKeys", {
    "Ctrl-Enter": () => { runProgram(); return false },
    "Cmd-Enter": () => { runProgram(); return false },
    ...hints.extraKeys
  })
  cm.setSize("100%", "100%")
  const refresh = () => cm.refresh()
  requestAnimationFrame(refresh)
  window.addEventListener("resize", refresh)
}

function setRunning(isRunning) {
  running = isRunning
  runBtn.disabled = isRunning
  stopBtn.disabled = !isRunning
}

function clearConsole() {
  consoleEl.innerHTML = ""
}

function addLine(text, cls) {
  const line = document.createElement("div")
  line.className = `console-line ${cls}`
  line.textContent = text
  consoleEl.appendChild(line)
  consoleEl.scrollTop = consoleEl.scrollHeight
}

function showPlaceholder() {
  if (!consoleEl.children.length) {
    const p = document.createElement("div")
    p.className = "console-empty"
    p.textContent = "Output will appear here. Press Run to start — INPUT prompts show as a field in this console, not a popup."
    consoleEl.appendChild(p)
  }
}

showPlaceholder()

runBtn.addEventListener("click", (e) => {
  e.preventDefault()
  runProgram()
})

stopBtn.addEventListener("click", (e) => {
  e.preventDefault()
  stopped = true
  if (pendingInput) pendingInput.resolve("")
})

clearBtn.addEventListener("click", (e) => {
  e.preventDefault()
  if (pendingInput) return
  clearConsole()
  showPlaceholder()
})

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault()
    runProgram()
  }
})

function makeIO() {
  return {
    shouldStop: () => stopped,
    output(text) { addLine(text, "console-out") },
    error(text) { addLine(text, "console-err") },
    info(text) { addLine(text, "console-info") },
    ok(text) { addLine(text, "console-ok") },
    input(name) {
      return new Promise((resolve) => {
        const row = document.createElement("div")
        row.className = "console-input-row"
        const label = document.createElement("label")
        label.textContent = `INPUT ${name} ←`
        const field = document.createElement("input")
        field.type = "text"
        field.autocomplete = "off"
        field.spellcheck = false
        field.setAttribute("aria-label", `Enter a value for ${name}`)
        field.placeholder = "Type a value and press Enter"
        const go = document.createElement("button")
        go.type = "button"
        go.className = "btn btn-primary"
        go.textContent = "Enter"
        row.append(label, field, go)
        consoleEl.appendChild(row)
        consoleEl.scrollTop = consoleEl.scrollHeight
        field.focus()

        const finish = (value) => {
          if (!pendingInput) return
          pendingInput = null
          field.disabled = true
          go.disabled = true
          resolve(value)
        }

        pendingInput = { resolve: finish, field }
        field.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault()
            finish(field.value)
          }
        })
        go.addEventListener("click", (ev) => {
          ev.preventDefault()
          finish(field.value)
        })
      })
    }
  }
}

async function runProgram() {
  if (running) return
  stopped = false
  pendingInput = null
  clearConsole()
  setRunning(true)
  const io = makeIO()
  try {
    await run(getCode(), io)
  } catch (err) {
    if (err && (err.name === "StopSignal" || stopped)) io.info("Stopped.")
    else io.error("Something went wrong while running this program. Check your syntax and try again.")
  } finally {
    pendingInput = null
    setRunning(false)
  }
}
