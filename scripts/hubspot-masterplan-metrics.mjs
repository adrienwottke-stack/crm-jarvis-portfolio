export function visibleWorkspaceMetrics() {
  const box = e => { const r = e?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } : null; };
  const shown = e => {
    const closed = e.closest("details:not([open])");
    if (closed && !closed.querySelector("summary")?.contains(e)) return false;
    const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const dock = document.querySelector(".crm-dock"), header = document.querySelector(".crm-header");
  const headerBox = box(header), dockBox = box(dock);
  const rows = [...document.querySelectorAll("[data-contact-row]")].filter(shown).map(box);
  const usableBottom = innerWidth < 1100 ? dockBox?.y ?? innerHeight : innerHeight;
  const touch = [...document.querySelectorAll('.crm-header button, .crm-header a, .crm-contacts-toolbar button, .crm-person-actions button, .crm-person-actions a')].filter(shown).map(e => ({ label: e.getAttribute("aria-label") ?? e.textContent?.trim(), ...box(e) })).filter(e => e.y >= 0 && e.y < innerHeight && e.label);
  const colorCanvas = document.createElement("canvas"); colorCanvas.width = 1; colorCanvas.height = 1;
  const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true }), colorCache = new Map();
  const parse = color => {
    if (colorCache.has(color)) return colorCache.get(color);
    colorContext.clearRect(0, 0, 1, 1); colorContext.fillStyle = color; colorContext.fillRect(0, 0, 1, 1);
    const rgba = [...colorContext.getImageData(0, 0, 1, 1).data]; const value = [rgba[0], rgba[1], rgba[2], rgba[3] / 255]; colorCache.set(color, value); return value;
  };
  const blend = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] + background[index] * (1 - foreground[3]));
  const luminance = rgb => rgb.map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const contrasts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const label = node.textContent.trim(); if (!label || label.length < 2) continue;
    const element = node.parentElement; if (!element || /SCRIPT|STYLE/.test(element.tagName) || !shown(element)) continue;
    const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1 || r.bottom < headerBox?.bottom || r.top > usableBottom) continue;
    const style = getComputedStyle(element), chain = []; let ancestor = element;
    while (ancestor) { chain.unshift(getComputedStyle(ancestor)); ancestor = ancestor.parentElement; }
    let background = [255, 255, 255]; for (const s of chain) background = blend(parse(s.backgroundColor), background);
    const color = blend(parse(style.color), background);
    const levels = [luminance(color), luminance(background)].sort((a, b) => b - a);
    const ratio = (levels[0] + .05) / (levels[1] + .05);
    const fontSize = parseFloat(style.fontSize), weight = parseInt(style.fontWeight, 10);
    const required = fontSize >= 24 || fontSize >= 18.66 && weight >= 700 ? 3 : 4.5;
    contrasts.push({ label: label.slice(0, 80), color: style.color, background: background.map(Math.round), ratio: Math.round(ratio * 100) / 100, required });
  }
  return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, header: headerBox, dock: dockBox, firstAction: box(document.querySelector(".crm-today-next")), primaryAction: box(document.querySelector(".crm-primary-action")), firstContact: rows[0] ?? null, completeRows: rows.filter(r => r.y >= headerBox?.bottom && r.bottom <= usableBottom).length, rows, smallTouchTargets: touch.filter(r => r.width < 43.5 || r.height < 43.5), contrastFailures: contrasts.filter(item => item.ratio < item.required), minimumContrast: contrasts.sort((a, b) => a.ratio - b.ratio).slice(0, 5) };
}
