import {
  berechne,
  euro,
  prozent,
  rendite,
  MODELL_HINWEIS,
  zielJahr,
  type RechnerWerte,
  type RechnerBerater,
} from "@/lib/zinsrechner";

// Standalone image: the same calculation as the screen, with its assumptions
// and selected goals. No CRM screenshots, external image host or customer data
// transfer is involved.
export async function erstelleRechnerBild(
  values: RechnerWerte,
  berater: RechnerBerater,
): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 2600;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Dein Browser kann gerade kein Bild erstellen.");
  const result = berechne(values),
    p = 64,
    right = 1016;
  ctx.fillStyle = "#0a1f3e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#3d97ff";
  ctx.fillRect(p, 60, 60, 5);
  const text = (
    value: string,
    x: number,
    y: number,
    size = 22,
    color = "#d9ebff",
    bold = false,
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 600 : 400} ${size}px system-ui, sans-serif`;
    ctx.fillText(value, x, y);
  };
  const wrap = (
    value: string,
    y: number,
    size = 22,
    color = "#d9ebff",
    lineHeight = 32,
  ) => {
    ctx.font = `400 ${size}px system-ui, sans-serif`;
    let line = "";
    for (const word of value.split(/\s+/)) {
      // Also wrap long unbroken names rather than letting them escape the image.
      for (const character of `${line ? " " : ""}${word}`) {
        if (ctx.measureText(line + character).width > right - p) {
          text(line, p, y, size, color);
          y += lineHeight;
          line = "";
        }
        line += character;
      }
    }
    if (line) text(line, p, y, size, color);
    return y + lineHeight;
  };
  text(
    `VERMÖGENSAUFBAU · ${new Date().toLocaleDateString("de-DE")}`,
    p,
    110,
    18,
  );
  let yy = wrap(
    values.customerName
      ? `Eine Berechnung für ${values.customerName}`
      : "Was aus deinem Geld werden kann.",
    170,
    36,
    "#ffffff",
    44,
  );
  yy = wrap(
    `${euro(values.start)} Startkapital · ${euro(values.monthly)} monatlich · ${values.years} Jahre · ${prozent(rendite(values))} p.a. angenommen`,
    yy + 16,
    23,
  );
  text("MÖGLICHES ENDKAPITAL", p, yy + 42, 18);
  text(euro(result.main.end), p, yy + 118, 68, "#ffffff", true);
  const chartTop = yy + 178,
    bottom = chartTop + 280,
    left = p + 60;
  const max =
    Math.max(
      1000,
      result.main.end,
      result.main.paid,
      result.cash.end,
      ...result.main.points.map((a) => a.total),
    ) * 1.08;
  const x = (year: number) => left + (year / values.years) * (right - left),
    y = (amount: number) => bottom - (amount / max) * 260;
  for (let i = 0; i <= 4; i++) {
    ctx.strokeStyle = "#294361";
    ctx.beginPath();
    ctx.moveTo(left, y((max * i) / 4));
    ctx.lineTo(right, y((max * i) / 4));
    ctx.stroke();
    text(euro((max * i) / 4), left, y((max * i) / 4) - 9, 16, "#93a3bc");
  }
  const trace = (
    points: typeof result.main.points,
    color: string,
    paid = false,
    dashed = false,
  ) => {
    ctx.beginPath();
    points.forEach((point, i) => {
      const method = i ? "lineTo" : "moveTo";
      ctx[method](x(point.year), y(paid ? point.paid : point.total));
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.setLineDash(dashed ? [10, 8] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  trace(result.cash.points, "#93a3bc", false, true);
  trace(result.main.points, "#d9ebff", true);
  if (result.delayed) trace(result.delayed.points, "#e8b65e", false, true);
  trace(result.main.points, "#3d97ff");
  text("Heute", left, bottom + 30, 18);
  text(`Jahr ${values.years}`, right - 90, bottom + 30, 18);
  yy = bottom + 70;
  text(
    "Blau: Gesamtkapital · Hell: eingezahlt · Gepunktet: Tagesgeld 1,5 %",
    p,
    yy,
    18,
  );
  if (result.delayed) {
    yy += 28;
    text(`Gold: Start ${values.waitYears} Jahre später`, p, yy, 18, "#e8b65e");
  }
  yy += 62;
  for (const [label, value] of [
    ["Selbst eingezahlt", euro(result.main.paid)],
    ["Wertentwicklung", euro(result.main.gain)],
    [
      "Entnahmebeispiel: 4 % p.a.",
      `${euro((result.main.end * 0.04) / 12)} / Monat`,
    ],
  ]) {
    text(label, p, yy, 22);
    text(value, 650, yy, 25, "#ffffff", true);
    yy += 42;
  }
  yy = wrap(
    "Das Entnahmebeispiel ist keine zugesagte oder dauerhaft gesicherte Rente.",
    yy + 4,
    18,
    "#93a3bc",
    26,
  );
  if (result.delayed)
    yy = wrap(
      `Bei einem Start ${values.waitYears} Jahre später: ${euro(result.delayed.end)} Endkapital. Unterschied im Modell: ${euro(result.main.end - result.delayed.end)}.`,
      yy + 20,
      22,
    );
  const goalText = values.goals
    .map((g) => {
      const year = zielJahr(result.main.points, g.amount);
      return `${g.name}: ${euro(g.amount)} (${year === null ? "im Zeitraum nicht erreicht" : year === 0 ? "bereits erreicht" : `Jahr ${year}`})`;
    })
    .join(" · ");
  if (goalText) yy = wrap(goalText, yy + 20, 20, "#d9ebff", 28);
  // Draw into a generous canvas, then crop after the last footer line. This
  // accommodates the validated maximum of eight named goals without clipping.
  const footerTop = Math.max(yy + 45, 1280);
  ctx.strokeStyle = "#294361";
  ctx.beginPath();
  ctx.moveTo(p, footerTop);
  ctx.lineTo(right, footerTop);
  ctx.stroke();
  let footer = wrap(MODELL_HINWEIS, footerTop + 35, 18, "#93a3bc", 26);
  footer = wrap(
    `Dein Berater: ${berater.name}`,
    footer + 20,
    24,
    "#ffffff",
    30,
  );
  footer = wrap(
    [berater.phone, berater.email].filter(Boolean).join(" · "),
    footer + 5,
    20,
    "#d9ebff",
    28,
  );
  const output = document.createElement("canvas");
  output.width = canvas.width;
  output.height = Math.ceil(footer + 40);
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Das Bild konnte nicht erstellt werden.");
  outputContext.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) =>
    output.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Das Bild konnte nicht erstellt werden.")),
      "image/png",
    ),
  );
}
