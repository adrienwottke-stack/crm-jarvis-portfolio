"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  achsenEuro,
  euro,
  type RechnerWerte,
  type berechne,
} from "@/lib/zinsrechner";
import styles from "./zinsrechner.module.css";

type Ergebnis = ReturnType<typeof berechne>;
export default function Verlauf({
  values,
  result,
}: {
  values: RechnerWerte;
  result: Ergebnis;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gradient = useId();
  const [width, setWidth] = useState(360);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(250, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const year = Math.min(values.years, selected ?? values.years);
  const point = result.main.points[year];
  const rawMax = Math.max(
    1000,
    ...result.main.points.map((p) => Math.max(p.total, p.paid)),
    result.cash.end,
  );
  const power = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = (Math.ceil((rawMax / power) * 2) / 2) * power;
  const left = width < 400 ? 55 : 70,
    right = width - 15,
    top = 24,
    bottom = 231;
  const x = (i: number) => left + (i / values.years) * (right - left);
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const path = (points: Ergebnis["main"]["points"], paid = false) =>
    points
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${x(p.year).toFixed(2)},${y(paid ? p.paid : p.total).toFixed(2)}`,
      )
      .join(" ");
  const pick = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const position = ((clientX - bounds.left) / bounds.width) * width;
    setSelected(
      Math.max(
        0,
        Math.min(
          values.years,
          Math.round(((position - left) / (right - left)) * values.years),
        ),
      ),
    );
  };
  return (
    <div ref={ref} className={styles.chart}>
      <div className={styles.legend} aria-label="Diagrammlegende">
        <span>
          <i className={styles.totalKey} />
          Gesamtkapital
        </span>
        <span>
          <i className={styles.paidKey} />
          Eingezahlt
        </span>
        <span>
          <i className={styles.cashKey} />
          Tagesgeld · 1,5 %
        </span>
        {result.delayed && (
          <span>
            <i className={styles.delayKey} />
            Späterer Start
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} 263`}
        role="img"
        aria-label={`Vermögensentwicklung: ${euro(result.main.end)} nach ${values.years} Jahren, davon ${euro(result.main.paid)} eingezahlt.`}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse")
            pick(event.clientX, event.currentTarget);
        }}
        onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-akzent)"
              stopOpacity=".25"
            />
            <stop
              offset="100%"
              stopColor="var(--color-akzent)"
              stopOpacity=".02"
            />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line
              x1={left}
              x2={right}
              y1={y((max * i) / 4)}
              y2={y((max * i) / 4)}
              stroke="var(--color-line)"
            />
            <text
              x={left - 8}
              y={y((max * i) / 4) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--color-ink-muted)"
            >
              {achsenEuro((max * i) / 4)}
            </text>
          </g>
        ))}
        {[...new Set([0, Math.round(values.years / 2), values.years])].map(
          (i) => (
            <text
              key={i}
              x={x(i)}
              y={253}
              textAnchor={
                i === 0 ? "start" : i === values.years ? "end" : "middle"
              }
              fontSize="12"
              fill="var(--color-ink-muted)"
            >
              {i === 0 ? "Heute" : `Jahr ${i}`}
            </text>
          ),
        )}
        <path
          d={`${path(result.main.points)} L${right},${bottom} L${left},${bottom} Z`}
          fill={`url(#${gradient})`}
        />
        <path
          d={path(result.main.points, true)}
          stroke="var(--color-ink-soft)"
          fill="none"
          strokeWidth="2"
        />
        <path
          d={path(result.cash.points)}
          stroke="var(--color-ink-muted)"
          fill="none"
          strokeWidth="2"
          strokeDasharray="3 5"
        />
        {result.delayed && (
          <path
            d={path(result.delayed.points)}
            stroke="var(--color-fest-warnung)"
            fill="none"
            strokeWidth="2"
            strokeDasharray="8 5"
          />
        )}
        {values.goals
          .filter((g) => g.amount <= max)
          .map((g, i) => (
            <g key={g.id}>
              <line
                x1={left}
                x2={right}
                y1={y(g.amount)}
                y2={y(g.amount)}
                stroke="var(--color-gold-600)"
                strokeDasharray="4 5"
                opacity=".8"
              />
              <title>
                {g.name}: {euro(g.amount)}
              </title>
              {i === 0 && (
                <text
                  x={left + 5}
                  y={Math.max(15, y(g.amount) - 7)}
                  fontSize="11"
                  fill="var(--color-ink-muted)"
                >
                  {g.name.slice(0, 25)}
                </text>
              )}
            </g>
          ))}
        <path
          d={path(result.main.points)}
          stroke="var(--color-akzent)"
          fill="none"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <line
          x1={x(year)}
          x2={x(year)}
          y1={top}
          y2={bottom}
          stroke="var(--color-ink-soft)"
          strokeDasharray="3 4"
        />
        <circle
          cx={x(year)}
          cy={y(point.total)}
          r="5"
          fill="var(--color-surface)"
          stroke="var(--color-akzent)"
          strokeWidth="3"
        />
      </svg>
      <label className={styles.yearLabel} htmlFor="rechner-jahr">
        {year === 0 ? "Heute" : `Nach ${year} Jahren`}
        <strong>{euro(point.total)}</strong>
      </label>
      <input
        id="rechner-jahr"
        aria-label="Jahr im Diagramm"
        className={styles.range}
        type="range"
        min="0"
        max={values.years}
        step="1"
        value={year}
        onChange={(event) => setSelected(Number(event.target.value))}
      />
      <p className={styles.small}>
        {euro(point.paid)} eingezahlt · {euro(point.total - point.paid)}{" "}
        Wertentwicklung
      </p>
    </div>
  );
}
