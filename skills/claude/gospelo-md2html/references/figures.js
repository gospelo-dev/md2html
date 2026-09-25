/* figures.js: render Mermaid and size every figure in the browser
 * (docs/02_pipeline.md section (2), docs/04_layout_logic.md section 3).
 *
 * Each <figure class="figure"> carries data-figure-w / data-figure-h / data-figure-r
 * (the box it must fit, in CSS px, and the height cap ratio) written by Python.
 * When done, <html data-figures="done"> is set; on any failure "error" plus
 * data-figures-error. Nothing here is duplicated in Python.
 */
(async function () {
  var root = document.documentElement;

  /* ---- column split: constants ---- */
  var SPLIT_MIN_GAIN = 1.3;
  var SPLIT_MAX_COLS = 4;
  var SPLIT_CUT_PAD = 4;
  var SPLIT_MAX_DRIFT = 0.35;
  var SPLIT_MIN_ASPECT = 2.0;

  /* ---- column split: suffix all IDs in a cloned SVG subtree ---- */
  function suffixSvgIds(el, suffix) {
    var idMap = {};
    var idEls = el.querySelectorAll("[id]");
    for (var i = 0; i < idEls.length; i++) {
      var old = idEls[i].getAttribute("id");
      idMap[old] = old + suffix;
      idEls[i].setAttribute("id", old + suffix);
    }
    var all = el.querySelectorAll("*");
    for (var j = 0; j < all.length; j++) {
      for (var k = 0; k < all[j].attributes.length; k++) {
        var a = all[j].attributes[k];
        var v = a.value;
        var nv = v.replace(/url\(#([^)]+)\)/g, function (_, id) {
          return idMap[id] ? "url(#" + idMap[id] + ")" : _;
        });
        if (a.localName === "href") {
          nv = nv.replace(/^#(.+)$/, function (_, id) {
            return idMap[id] ? "#" + idMap[id] : _;
          });
        }
        if (nv !== v) a.value = nv;
      }
      var st = all[j].getAttribute("style");
      if (st) {
        var ns = st.replace(/url\(#([^)]+)\)/g, function (_, id) {
          return idMap[id] ? "url(#" + idMap[id] + ")" : _;
        });
        if (ns !== st) all[j].setAttribute("style", ns);
      }
    }
  }

  /* ---- column split: find free horizontal bands between obstacles ---- */
  function findFreeBands(svg, vb) {
    var svgRect = svg.getBoundingClientRect();
    if (!svgRect.height) return [[vb.y, vb.y + vb.height]];
    var k = svgRect.height / vb.height;
    var obstacles = [];
    var sels = ["g.node", "g.edgeLabel", ".cluster-label"];
    for (var si = 0; si < sels.length; si++) {
      var els = svg.querySelectorAll(sels[si]);
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.height < 1) continue;
        obstacles.push([
          vb.y + (r.top - svgRect.top) / k - SPLIT_CUT_PAD,
          vb.y + (r.bottom - svgRect.top) / k + SPLIT_CUT_PAD
        ]);
      }
    }
    var clusters = svg.querySelectorAll("g.cluster rect");
    for (var ci = 0; ci < clusters.length; ci++) {
      var cr = clusters[ci].getBoundingClientRect();
      if (cr.height / k < vb.height * 0.5) {
        obstacles.push([
          vb.y + (cr.top - svgRect.top) / k - SPLIT_CUT_PAD,
          vb.y + (cr.bottom - svgRect.top) / k + SPLIT_CUT_PAD
        ]);
      }
    }
    obstacles.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    for (var mi = 0; mi < obstacles.length; mi++) {
      if (merged.length && obstacles[mi][0] <= merged[merged.length - 1][1]) {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], obstacles[mi][1]);
      } else {
        merged.push(obstacles[mi].slice());
      }
    }
    var free = [];
    var start = vb.y;
    for (var fi = 0; fi < merged.length; fi++) {
      if (merged[fi][0] > start) free.push([start, merged[fi][0]]);
      start = merged[fi][1];
    }
    if (start < vb.y + vb.height) free.push([start, vb.y + vb.height]);
    return free;
  }

  /* ---- column split: nearest valid cut position in a free band ---- */
  function findBestCut(ideal, freeBands, maxDrift) {
    var best = null, bestDist = Infinity;
    for (var i = 0; i < freeBands.length; i++) {
      var a = freeBands[i][0], b = freeBands[i][1];
      if (b - a < 1) continue;
      var y = Math.max(a, Math.min(ideal, b));
      var d = Math.abs(y - ideal);
      if (d < bestDist) { bestDist = d; best = y; }
    }
    if (best !== null && bestDist > maxDrift) return null;
    return best;
  }

  /* ---- column split: evaluate and restructure ---- */
  var SPLIT_FIGURE_R = 0.8;
  var SPLIT_MIN_FONT_PX = 11;

  function maybeSplit(fig, svg, W, Hcap, iw, ih) {
    var role = svg.getAttribute("aria-roledescription") || "";
    if (role.indexOf("flowchart") < 0) return;
    if (svg.dataset.splitColumns) return;

    var vb = svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width || !vb.height) return;

    var s1 = Math.min(1, W / iw, Hcap / ih);
    if (s1 >= 0.9) return;
    if (ih / iw < SPLIT_MIN_ASPECT) return;

    var figH = parseFloat(fig.dataset.figureH);
    var figR = parseFloat(fig.dataset.figureR) || 0.6;
    var splitHcap = Hcap + figH * Math.max(0, SPLIT_FIGURE_R - figR);

    var savedStyle = svg.getAttribute("style") || "";
    var savedW = svg.getAttribute("width");
    var savedH = svg.getAttribute("height");
    svg.removeAttribute("style");
    svg.setAttribute("width", String(iw));
    svg.setAttribute("height", String(ih));
    svg.style.maxWidth = "none";

    var freeBands = findFreeBands(svg, vb);

    svg.setAttribute("style", savedStyle);
    if (savedW) svg.setAttribute("width", savedW); else svg.removeAttribute("width");
    if (savedH) svg.setAttribute("height", savedH); else svg.removeAttribute("height");

    var fontPx = parseFloat(root.dataset.mermaidFontSize || "14");
    var G = fontPx * 2.5;
    var bestN = 1, bestScale = s1, bestCuts = null;

    for (var n = 2; n <= SPLIT_MAX_COLS; n++) {
      var cuts = [vb.y];
      var ok = true;
      for (var c = 1; c < n; c++) {
        var ideal = vb.y + c * ih / n;
        var cut = findBestCut(ideal, freeBands, SPLIT_MAX_DRIFT * ih / n);
        if (cut === null) { ok = false; break; }
        if (cut <= cuts[cuts.length - 1]) { ok = false; break; }
        cuts.push(cut);
      }
      if (!ok) continue;
      cuts.push(vb.y + ih);
      var overlapN = Math.min(ih / n * 0.06, fontPx * 3);
      var maxSH = 0;
      for (var si = 0; si < n; si++) {
        var top = cuts[si] - (si > 0 ? overlapN : 0);
        var bot = cuts[si + 1] + (si < n - 1 ? overlapN : 0);
        var sh = bot - top;
        if (sh > maxSH) maxSH = sh;
      }
      var sW = (W - (n - 1) * G) / (n * iw);
      var sH = splitHcap / maxSH;
      var sn = Math.min(1, sW, sH);
      if (fontPx * sn < SPLIT_MIN_FONT_PX) continue;
      if (sn > bestScale) { bestN = n; bestScale = sn; bestCuts = cuts; }
    }

    if (bestN <= 1 || bestScale < SPLIT_MIN_GAIN * s1) return;

    var N = bestN;
    var allCuts = bestCuts;
    var overlap = Math.min(ih / N * 0.06, fontPx * 3);
    var maxStripH = 0;
    for (var si = 0; si < N; si++) {
      var top = allCuts[si] - (si > 0 ? overlap : 0);
      var bot = allCuts[si + 1] + (si < N - 1 ? overlap : 0);
      var sh = bot - top;
      if (sh > maxStripH) maxStripH = sh;
    }
    var gapVb = G / bestScale;
    var totalW = iw * N + gapVb * (N - 1);

    var contentNodes = [];
    var node = svg.firstChild;
    while (node) {
      var next = node.nextSibling;
      if (node.nodeName !== "style" && node.nodeName !== "STYLE") {
        contentNodes.push(svg.removeChild(node));
      }
      node = next;
    }
    var templateG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (var ci = 0; ci < contentNodes.length; ci++) {
      templateG.appendChild(contentNodes[ci]);
    }

    var clones = [];
    for (var i = 1; i < N; i++) {
      var clone = templateG.cloneNode(true);
      suffixSvgIds(clone, "_s" + i);
      clones.push(clone);
    }

    for (var i = 0; i < N; i++) {
      var stripTop = allCuts[i] - (i > 0 ? overlap : 0);
      var stripBot = allCuts[i + 1] + (i < N - 1 ? overlap : 0);
      var stripH = stripBot - stripTop;
      var colX = i * (iw + gapVb);
      var nested = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      nested.setAttribute("x", String(colX));
      nested.setAttribute("y", "0");
      nested.setAttribute("width", String(iw));
      nested.setAttribute("height", String(stripH));
      nested.setAttribute("viewBox", vb.x + " " + stripTop + " " + iw + " " + stripH);
      nested.setAttribute("overflow", "hidden");

      var src = i === 0 ? templateG : clones[i - 1];
      while (src.firstChild) { nested.appendChild(src.firstChild); }
      svg.appendChild(nested);

      if (i < N - 1) {
        var lx = colX + iw + gapVb / 2;
        var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "md2html-strip-rule");
        line.setAttribute("x1", String(lx));
        line.setAttribute("y1", "0");
        line.setAttribute("x2", String(lx));
        line.setAttribute("y2", String(maxStripH));
        line.setAttribute("stroke", "#ccc");
        line.setAttribute("stroke-opacity", "0.4");
        line.setAttribute("stroke-dasharray", "6 3");
        line.setAttribute("stroke-width", "1");
        svg.appendChild(line);
      }
    }

    svg.setAttribute("viewBox", "0 0 " + totalW + " " + maxStripH);
    svg.dataset.splitColumns = String(N);
    fig.dataset.split = String(N);
    fig.dataset.figureR = String(SPLIT_FIGURE_R);
  }

  try {
    var mermaidNodes = document.querySelectorAll("pre.mermaid");
    if (mermaidNodes.length > 0) {
      if (!window.mermaid) { throw new Error("mermaid library is not loaded"); }
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "loose",
        themeVariables: {
          fontSize: root.dataset.mermaidFontSize || "14px",
          fontFamily: getComputedStyle(document.body).fontFamily
        }
      });
    }
    if (document.fonts && document.fonts.ready) { await document.fonts.ready; }
    if (mermaidNodes.length > 0) {
      await window.mermaid.run({ nodes: mermaidNodes, suppressErrors: false });
    }
    if (window.__shikiInit) { await window.__shikiInit(); }
    var imgs = Array.prototype.slice.call(document.querySelectorAll("figure.figure img"));
    await Promise.all(imgs.map(function (img) {
      return img.decode().catch(function () {
        throw new Error("image failed to load: " + img.getAttribute("src"));
      });
    }));
    var figures = document.querySelectorAll("figure.figure");
    figures.forEach(function (fig) {
      var W = parseFloat(fig.dataset.figureW);
      var H = parseFloat(fig.dataset.figureH);
      var r = parseFloat(fig.dataset.figureR);
      var imageScale = parseFloat(fig.dataset.imageScale || "1");
      var fcs = getComputedStyle(fig);
      var extra = (parseFloat(fcs.marginTop) || 0) + (parseFloat(fcs.marginBottom) || 0);
      var cap = fig.querySelector("figcaption");
      if (cap) { extra += cap.getBoundingClientRect().height + (parseFloat(getComputedStyle(cap).marginTop) || 0); }
      var el = fig.querySelector("svg");
      var iw, ih;
      if (el) {
        var vb = el.viewBox && el.viewBox.baseVal;
        iw = vb ? vb.width : 0; ih = vb ? vb.height : 0;
        if (!iw || !ih) { var bb = el.getBBox(); iw = bb.width; ih = bb.height; }
        if (fig.dataset.type === "mermaid" && iw > 0 && ih > 0) {
          maybeSplit(fig, el, W, Math.max(1, H * r - extra), iw, ih);
          vb = el.viewBox && el.viewBox.baseVal;
          if (vb && vb.width > 0 && vb.height > 0) { iw = vb.width; ih = vb.height; }
          r = parseFloat(fig.dataset.figureR);
        }
        el.removeAttribute("style");
        el.style.maxWidth = "none";
      } else {
        el = fig.querySelector("img");
        if (!el) { throw new Error("figure without svg or img: " + (fig.dataset.block || "")); }
        iw = el.naturalWidth / imageScale; ih = el.naturalHeight / imageScale;
      }
      if (!(iw > 0 && ih > 0)) { throw new Error("no intrinsic size: " + (fig.dataset.block || "")); }
      var s = Math.min(1, W / iw, Math.max(1, H * r - extra) / ih);
      var w = Math.round(iw * s), h = Math.round(ih * s);
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(h));
      el.style.width = w + "px";
      el.style.height = h + "px";
      fig.dataset.scale = s.toFixed(3);
      fig.dataset.intrinsicW = String(Math.round(iw));
      fig.dataset.intrinsicH = String(Math.round(ih));
    });
    root.dataset.figures = "done";
  } catch (e) {
    root.dataset.figuresError = String((e && e.message) || e);
    root.dataset.figures = "error";
  }
})();
