import { COMPLETIONS } from "./lang/completions.js"

export function matchingCompletions(prefix, list = COMPLETIONS) {
  if (!prefix) return []
  const p = prefix.toUpperCase()
  if (!/^[A-Z_][A-Z0-9_]*$/.test(p)) return []
  return list.filter((word) => word.startsWith(p))
}

export function inStringOrComment(line, ch) {
  const before = line.slice(0, ch)
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < before.length; i++) {
    const c = before[i]
    const n = before[i + 1]
    if (!inDouble && !inSingle && c === "/" && n === "/") return true
    if (!inSingle && c === '"') inDouble = !inDouble
    else if (!inDouble && c === "'") inSingle = !inSingle
  }
  return inDouble || inSingle
}

export function attachAutocomplete(cm) {
  const menu = document.createElement("ul")
  menu.className = "cm-hints"
  menu.hidden = true
  menu.setAttribute("role", "listbox")
  document.body.appendChild(menu)

  let items = []
  let selected = 0
  let from = null
  let to = null

  function isOpen() {
    return !menu.hidden && items.length > 0
  }

  function close() {
    menu.hidden = true
    menu.innerHTML = ""
    items = []
    from = null
    to = null
  }

  function pick(index = selected) {
    const word = items[index]
    if (!word || !from) return
    const start = from
    const end = to
    close()
    cm.replaceRange(word, start, end, "complete")
    cm.focus()
  }

  function move(delta) {
    if (!items.length) return
    selected = (selected + delta + items.length) % items.length
    render()
  }

  function render() {
    menu.innerHTML = ""
    items.forEach((word, i) => {
      const li = document.createElement("li")
      li.className = "cm-hint" + (i === selected ? " cm-hint-active" : "")
      li.textContent = word
      li.setAttribute("role", "option")
      li.addEventListener("mousedown", (e) => {
        e.preventDefault()
        pick(i)
      })
      menu.appendChild(li)
    })
    const active = menu.children[selected]
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" })

    const coords = cm.cursorCoords(from, "page")
    menu.style.left = `${coords.left}px`
    const below = coords.bottom + 6
    menu.hidden = false
    const height = menu.offsetHeight
    if (below + height > window.innerHeight - 12) {
      menu.style.top = `${Math.max(8, coords.top - height - 6)}px`
    } else {
      menu.style.top = `${below}px`
    }
  }

  function currentPrefix() {
    const cur = cm.getCursor()
    const line = cm.getLine(cur.line)
    if (inStringOrComment(line, cur.ch)) return null
    const token = cm.getTokenAt(cur)
    if (token.type === "string" || token.type === "comment" || token.type === "number") return null
    let word = token.string
    let start = token.start
    if (token.end > cur.ch) {
      word = word.slice(0, cur.ch - token.start)
    } else if (token.end < cur.ch) {
      return null
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(word)) return null
    return {
      word,
      from: window.CodeMirror.Pos(cur.line, start),
      to: cur
    }
  }

  function update() {
    const ctx = currentPrefix()
    if (!ctx) {
      close()
      return
    }
    const list = matchingCompletions(ctx.word)
    if (!list.length || (list.length === 1 && list[0] === ctx.word)) {
      close()
      return
    }
    items = list
    selected = 0
    from = ctx.from
    to = ctx.to
    render()
  }

  cm.on("inputRead", (_ed, change) => {
    if (change.origin !== "+input") return
    if (!change.text.some((t) => /[A-Za-z_]/.test(t))) return
    update()
  })

  cm.on("cursorActivity", () => {
    if (isOpen()) update()
  })

  cm.on("blur", () => {
    setTimeout(close, 120)
  })

  document.addEventListener("mousedown", (e) => {
    if (!menu.contains(e.target) && e.target.closest(".CodeMirror") !== cm.getWrapperElement()) {
      close()
    }
  })

  return {
    isOpen,
    extraKeys: {
      Up() {
        if (!isOpen()) return window.CodeMirror.Pass
        move(-1)
        return true
      },
      Down() {
        if (!isOpen()) return window.CodeMirror.Pass
        move(1)
        return true
      },
      Enter() {
        if (!isOpen()) return window.CodeMirror.Pass
        pick()
        return true
      },
      Tab() {
        if (!isOpen()) return window.CodeMirror.Pass
        pick()
        return true
      },
      Esc() {
        if (!isOpen()) return window.CodeMirror.Pass
        close()
        return true
      },
      "Ctrl-Space"() {
        update()
        return true
      }
    }
  }
}
