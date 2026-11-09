// PPTX export: one image slide per rendered page, plus invisible link hotspots and
// an optional transparent selectable-text layer.
//
// The slide is a screenshot of the page's <section class="page"> taken by the same
// browser that verified the layout, so the deck shows exactly what the HTML shows.
// Links and text lines are read from the DOM (fractions of the page box). Slide
// size equals the page format.
//
// The package is written directly (OOXML in a zip, fflate): the decks need only
// pictures, text boxes and rectangles with hyperlinks.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { zipSync } from 'fflate'
import { call, type Browser } from './measure.ts'

const MM_TO_EMU = 36000
const PT_PER_MM = 72.0 / 25.4

const PAGES_JS = String.raw`
(withText) => Array.from(document.querySelectorAll('section.page')).map(sec => {
  const R = sec.getBoundingClientRect();
  const rel = (r) => [(r.left - R.left) / R.width, (r.top - R.top) / R.height, r.width / R.width, r.height / R.height];
  const links = [];
  for (const a of sec.querySelectorAll('a[href]')) {
    for (const r of a.getClientRects()) {
      if (r.width > 0 && r.height > 0) { links.push({ href: a.href, rect: rel(r) }); }
    }
  }
  const lines = [];
  if (withText) {
    const walker = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue;
      if (!text.trim()) { continue; }
      const p = node.parentElement;
      if (!p || p.closest('svg, script, style')) { continue; }
      const cs = getComputedStyle(p);
      if (cs.visibility === 'hidden' || cs.display === 'none') { continue; }
      const size = parseFloat(cs.fontSize);
      let cur = null, lastTop = null;
      for (let i = 0; i < text.length; i++) {
        const rg = document.createRange();
        rg.setStart(node, i); rg.setEnd(node, i + 1);
        const rects = rg.getClientRects();
        if (!rects.length) { continue; }
        const rc = rects[0];
        if (rc.width === 0 && text[i] === '\n') { continue; }
        if (cur === null || Math.abs(rc.top - lastTop) > 1) {
          if (cur !== null) { lines.push(cur); }
          cur = { text: '', left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom, size };
          lastTop = rc.top;
        }
        cur.text += text[i];
        cur.left = Math.min(cur.left, rc.left); cur.right = Math.max(cur.right, rc.right);
        cur.top = Math.min(cur.top, rc.top); cur.bottom = Math.max(cur.bottom, rc.bottom);
      }
      if (cur !== null) { lines.push(cur); }
    }
  }
  return {
    id: sec.dataset.pageId,
    links,
    lines: lines.filter(l => l.text.trim()).map(l => ({
      text: l.text, size: l.size / R.height,
      rect: rel({ left: l.left, top: l.top, width: l.right - l.left, height: l.bottom - l.top })
    }))
  };
})
`

type Rect = [number, number, number, number] // x, y, w, h as fractions of the page

export interface SlideData {
  id: string
  image: Uint8Array
  imageFormat: 'jpeg' | 'png'
  links: Array<{ href: string; rect: Rect }>
  lines: Array<{ text: string; size: number; rect: Rect }> // size: fraction of page height
}

export interface PptxOptions {
  dpi: number // screenshot resolution (CSS px are 96 dpi)
  imageFormat: 'jpeg' | 'png'
  jpegQuality: number
  textLayer: boolean // transparent selectable text over the image
  linkHotspots: boolean // invisible clickable rectangles over <a href>
}

/** Screenshot every rendered page and read its links (and text lines) from the DOM. */
export async function capturePages(browser: Browser, htmlPath: string, opts: PptxOptions): Promise<SlideData[]> {
  const page = await browser.open(htmlPath, opts.dpi / 96.0)
  try {
    const meta = await call<Array<Omit<SlideData, 'image' | 'imageFormat'>>>(page, PAGES_JS, opts.textLayer)
    const sections = await page.$$('section.page')
    if (sections.length !== meta.length) throw new Error('page count mismatch while capturing slides')
    const out: SlideData[] = []
    for (let i = 0; i < sections.length; i++) {
      const image =
        opts.imageFormat === 'png'
          ? await sections[i]!.screenshot({ type: 'png' })
          : await sections[i]!.screenshot({ type: 'jpeg', quality: opts.jpegQuality })
      out.push({ ...meta[i]!, image, imageFormat: opts.imageFormat })
    }
    return out
  } finally {
    await page.close()
  }
}

// --------------------------------------------------------------------------
// OOXML

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** XML text: escaped, without the control characters XML 1.0 does not allow. */
function x(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function rels(items: Array<{ id: string; type: string; target: string; external?: boolean }>): string {
  const body = items
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type.startsWith('http') ? r.type : `${REL}/${r.type}`}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')
  return `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
}

const THEME = `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements>` +
  '<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1>' +
  '<a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink>' +
  '<a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>' +
  '<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>' +
  '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>' +
  '<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>' +
  '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
  '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'

const EMPTY_TREE =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

const MASTER =
  `${XML_HEAD}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" ' +
  'accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>'

const LAYOUT =
  `${XML_HEAD}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1">` +
  `<p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

function xfrm(x0: number, y0: number, cx: number, cy: number): string {
  return `<a:xfrm><a:off x="${x0}" y="${y0}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
}

/** Write the deck. Returns counts for the report. */
export function assemblePptx(slides: SlideData[], widthMm: number, heightMm: number, pptxPath: string, opts: PptxOptions) {
  const slideW = Math.round(widthMm * MM_TO_EMU)
  const slideH = Math.round(heightMm * MM_TO_EMU)
  const pageHPt = heightMm * PT_PER_MM
  const box = ([fx, fy, fw, fh]: Rect): [number, number, number, number] => [
    Math.trunc(fx * slideW),
    Math.trunc(fy * slideH),
    Math.max(1, Math.trunc(fw * slideW)),
    Math.max(1, Math.trunc(fh * slideH)),
  ]
  const files: Record<string, Uint8Array> = {}
  const enc = new TextEncoder()
  const put = (name: string, text: string): void => {
    files[name] = enc.encode(text)
  }
  let nLinks = 0
  let nLines = 0
  const exts = new Set<string>()

  slides.forEach((s, idx) => {
    const n = idx + 1
    const ext = s.imageFormat === 'png' ? 'png' : 'jpeg'
    exts.add(ext)
    files[`ppt/media/image${n}.${ext}`] = s.image
    const slideRels: Array<{ id: string; type: string; target: string; external?: boolean }> = [
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'image', target: `../media/image${n}.${ext}` },
    ]
    let shapeId = 2
    const shapes: string[] = [
      `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId++}" name="Picture 1"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr>${xfrm(0, 0, slideW, slideH)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    ]
    if (opts.textLayer) {
      for (const ln of s.lines) {
        const [bx, by, bw, bh] = box(ln.rect)
        const sz = Math.round(Math.max(1.0, ln.size * pageHPt) * 100)
        const id = shapeId++
        shapes.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id - 1}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
            `<p:spPr>${xfrm(bx, by, bw, bh)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
            `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>` +
            // noProof: no spell-check squiggle over invisible text; alpha 0: transparent
            `<a:p><a:r><a:rPr lang="ja-JP" sz="${sz}" noProof="1"><a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:rPr>` +
            `<a:t>${x(ln.text)}</a:t></a:r></a:p></p:txBody></p:sp>`,
        )
        nLines++
      }
    }
    if (opts.linkHotspots) {
      for (const lk of s.links) {
        const [bx, by, bw, bh] = box(lk.rect)
        const rid = `rId${slideRels.length + 1}`
        slideRels.push({ id: rid, type: 'hyperlink', target: lk.href, external: true })
        const id = shapeId++
        shapes.push(
          `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Rectangle ${id - 1}"><a:hlinkClick r:id="${rid}"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
            `<p:spPr>${xfrm(bx, by, bw, bh)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
            // clickable but invisible
            `<a:solidFill><a:srgbClr val="000000"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln><a:effectLst/></p:spPr></p:sp>`,
        )
        nLinks++
      }
    }
    put(
      `ppt/slides/slide${n}.xml`,
      `${XML_HEAD}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${EMPTY_TREE}${shapes.join('')}</p:spTree></p:cSld>` +
        '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>',
    )
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels))
  })

  const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')
  put(
    'ppt/presentation.xml',
    `${XML_HEAD}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1">` +
      '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
      (slides.length ? `<p:sldIdLst>${slideIds}</p:sldIdLst>` : '') +
      `<p:sldSz cx="${slideW}" cy="${slideH}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  )
  const presRels = [
    { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
    ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` })),
  ]
  const n0 = slides.length + 2
  presRels.push(
    { id: `rId${n0}`, type: 'presProps', target: 'presProps.xml' },
    { id: `rId${n0 + 1}`, type: 'viewProps', target: 'viewProps.xml' },
    { id: `rId${n0 + 2}`, type: 'theme', target: 'theme/theme1.xml' },
    { id: `rId${n0 + 3}`, type: 'tableStyles', target: 'tableStyles.xml' },
  )
  put('ppt/_rels/presentation.xml.rels', rels(presRels))
  put('ppt/presProps.xml', `${XML_HEAD}<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`)
  put('ppt/viewProps.xml', `${XML_HEAD}<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`)
  put('ppt/tableStyles.xml', `${XML_HEAD}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`)
  put('ppt/theme/theme1.xml', THEME)
  put('ppt/slideMasters/slideMaster1.xml', MASTER)
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ]),
  )
  put('ppt/slideLayouts/slideLayout1.xml', LAYOUT)
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]))
  put(
    'docProps/app.xml',
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>gospelo-md2html</Application></Properties>`,
  )
  put(
    'docProps/core.xml',
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>gospelo-md2html</dc:creator></cp:coreProperties>',
  )
  put(
    '_rels/.rels',
    rels([
      { id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' },
      { id: 'rId2', type: 'extended-properties', target: 'docProps/app.xml' },
      {
        id: 'rId3',
        type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
        target: 'docProps/core.xml',
      },
    ]),
  )
  const pres = 'application/vnd.openxmlformats-officedocument.presentationml'
  const overrides = [
    ['/ppt/presentation.xml', `${pres}.presentation.main+xml`],
    ['/ppt/presProps.xml', `${pres}.presProps+xml`],
    ['/ppt/viewProps.xml', `${pres}.viewProps+xml`],
    ['/ppt/tableStyles.xml', `${pres}.tableStyles+xml`],
    ['/ppt/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml'],
    ['/ppt/slideMasters/slideMaster1.xml', `${pres}.slideMaster+xml`],
    ['/ppt/slideLayouts/slideLayout1.xml', `${pres}.slideLayout+xml`],
    ['/docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml'],
    ['/docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml'],
    ...slides.map((_, i) => [`/ppt/slides/slide${i + 1}.xml`, `${pres}.slide+xml`]),
  ]
  const defaults = [
    ['rels', 'application/vnd.openxmlformats-package.relationships+xml'],
    ['xml', 'application/xml'],
    ...[...exts].map((e) => [e, e === 'png' ? 'image/png' : 'image/jpeg']),
  ]
  put(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('') +
      overrides.map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`).join('') +
      '</Types>',
  )
  // [Content_Types].xml first, as Office writes it
  const ordered: Record<string, Uint8Array> = { '[Content_Types].xml': files['[Content_Types].xml']! }
  for (const [k, v] of Object.entries(files)) if (k !== '[Content_Types].xml') ordered[k] = v
  mkdirSync(dirname(pptxPath), { recursive: true })
  writeFileSync(pptxPath, zipSync(ordered, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') }))
  return { slides: slides.length, links: nLinks, textLines: nLines }
}

export async function exportPptx(browser: Browser, htmlPath: string, pptxPath: string, widthMm: number, heightMm: number, opts: PptxOptions) {
  return assemblePptx(await capturePages(browser, htmlPath, opts), widthMm, heightMm, pptxPath, opts)
}
