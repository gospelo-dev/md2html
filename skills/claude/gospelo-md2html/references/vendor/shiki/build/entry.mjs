import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import githubLightHC from 'shiki/themes/github-light-high-contrast.mjs'
import langJson from 'shiki/langs/json.mjs'
import langBash from 'shiki/langs/bash.mjs'
import langShell from 'shiki/langs/shellscript.mjs'
import langYaml from 'shiki/langs/yaml.mjs'
import langPython from 'shiki/langs/python.mjs'
import langJavascript from 'shiki/langs/javascript.mjs'
import langTypescript from 'shiki/langs/typescript.mjs'
import langHtml from 'shiki/langs/html.mjs'
import langCss from 'shiki/langs/css.mjs'
import langSql from 'shiki/langs/sql.mjs'
import langToml from 'shiki/langs/toml.mjs'
import langMarkdown from 'shiki/langs/markdown.mjs'
import langDiff from 'shiki/langs/diff.mjs'
import langDockerfile from 'shiki/langs/dockerfile.mjs'

window.__shikiInit = async function () {
  const highlighter = await createHighlighterCore({
    themes: [githubLightHC],
    langs: [langJson, langBash, langShell, langYaml, langPython,
            langJavascript, langTypescript, langHtml, langCss,
            langSql, langToml, langMarkdown, langDiff, langDockerfile],
    engine: createJavaScriptRegexEngine(),
  })
  const loaded = new Set(highlighter.getLoadedLanguages())
  const THEME = 'github-light-high-contrast'
  document.querySelectorAll('pre.code[data-lang]').forEach(function (pre) {
    var lang = pre.dataset.lang
    if (!loaded.has(lang)) return
    var code = pre.querySelector('code')
    if (!code) return
    var lines = code.querySelectorAll('.line')
    var text = Array.from(lines).map(function (l) { return l.textContent }).join('\n')
    var tokens = highlighter.codeToTokensBase(text, { lang: lang, theme: THEME })
    for (var i = 0; i < tokens.length && i < lines.length; i++) {
      var html = ''
      for (var j = 0; j < tokens[i].length; j++) {
        var t = tokens[i][j]
        var escaped = t.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        if (t.color && t.color !== '#0e1116') {
          html += '<span style="color:' + t.color + '">' + escaped + '</span>'
        } else {
          html += escaped
        }
      }
      lines[i].innerHTML = html || ' '
    }
    pre.dataset.highlighted = 'true'
  })
}
