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
  try {
    var mermaidNodes = document.querySelectorAll("pre.mermaid");
    if (mermaidNodes.length > 0) {
      if (!window.mermaid) { throw new Error("mermaid library is not loaded"); }
      window.mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "loose",
        themeVariables: { fontSize: root.dataset.mermaidFontSize || "14px" }
      });
      await window.mermaid.run({ nodes: mermaidNodes, suppressErrors: false });
    }
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
      var el = fig.querySelector("svg");
      var iw, ih;
      if (el) {
        var vb = el.viewBox && el.viewBox.baseVal;
        iw = vb ? vb.width : 0; ih = vb ? vb.height : 0;
        if (!iw || !ih) { var bb = el.getBBox(); iw = bb.width; ih = bb.height; }
        el.removeAttribute("style");
        el.style.maxWidth = "none";
      } else {
        el = fig.querySelector("img");
        if (!el) { throw new Error("figure without svg or img: " + (fig.dataset.block || "")); }
        iw = el.naturalWidth / imageScale; ih = el.naturalHeight / imageScale;
      }
      if (!(iw > 0 && ih > 0)) { throw new Error("no intrinsic size: " + (fig.dataset.block || "")); }
      var s = Math.min(1, W / iw, (H * r) / ih);
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
