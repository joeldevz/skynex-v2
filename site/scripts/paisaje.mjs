#!/usr/bin/env node
// Genera public/paisaje.svg: paisaje pintado (montañas, lago, pradera con flores)
// inspirado en la cabecera de Duna (Mobbin). Determinista: misma semilla, mismo dibujo.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/paisaje.svg');

let seed = 20260929;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a, b) => a + rnd() * (b - a);

// Puntos dentro de un polígono simple (par/impar).
function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const leftBank = [[0, 575], [160, 580], [300, 612], [420, 650], [470, 690], [400, 730], [260, 770], [120, 805], [0, 830]];
const rightBank = [[1600, 585], [1440, 598], [1300, 622], [1205, 652], [1190, 684], [1290, 712], [1450, 736], [1600, 752]];
const poly = (pts) => 'M' + pts.map((p) => p.join(' ')).join(' L') + ' Z';

function meadow(bank, box, count) {
  const blades = [];
  const flowers = [];
  let tries = 0;
  while (blades.length < count && tries++ < count * 20) {
    const p = [between(box[0], box[2]), between(box[1], box[3])];
    if (!inside(p, bank)) continue;
    const h = between(8, 22);
    const lean = between(-4, 4);
    blades.push(`<path d="M${p[0].toFixed(1)} ${p[1].toFixed(1)} q${(lean / 2).toFixed(1)} ${(-h / 2).toFixed(1)} ${lean.toFixed(1)} ${(-h).toFixed(1)}" stroke="${rnd() > 0.5 ? '#6d8f2f' : '#a9bf55'}" stroke-width="${between(1, 2.2).toFixed(1)}" fill="none" stroke-linecap="round" opacity="${between(0.5, 0.9).toFixed(2)}"/>`);
    if (rnd() > 0.72) {
      const colors = ['#f39bbd', '#f7b6cf', '#ffe9a8', '#fff6e0', '#e67aa6'];
      flowers.push(`<circle cx="${(p[0] + lean).toFixed(1)}" cy="${(p[1] - h).toFixed(1)}" r="${between(1.6, 3.4).toFixed(1)}" fill="${colors[Math.floor(rnd() * colors.length)]}"/>`);
    }
  }
  return blades.join('') + flowers.join('');
}

const clouds = Array.from({ length: 14 }, (_, i) => {
  const x = between(-100, 1700);
  const y = between(40, 330);
  const warm = y > 190;
  return `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${between(140, 320).toFixed(0)}" ry="${between(28, 70).toFixed(0)}" fill="${warm ? (i % 2 ? '#fde3bd' : '#fbd2a4') : i % 2 ? '#e9eef2' : '#d7e0e8'}" opacity="${between(0.55, 0.9).toFixed(2)}"/>`;
}).join('');

const streaks = Array.from({ length: 16 }, () => {
  const y = between(600, 760);
  return `<ellipse cx="${between(450, 1250).toFixed(0)}" cy="${y.toFixed(0)}" rx="${between(60, 220).toFixed(0)}" ry="${between(1.2, 3).toFixed(1)}" fill="#fff" opacity="${between(0.25, 0.55).toFixed(2)}"/>`;
}).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#a9bccd"/><stop offset=".22" stop-color="#e3cdb2"/>
    <stop offset=".42" stop-color="#f8c47f"/><stop offset=".58" stop-color="#f5a978"/>
  </linearGradient>
  <radialGradient id="sun" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(980 520) scale(560 250)">
    <stop offset="0" stop-color="#fff2cc" stop-opacity=".95"/><stop offset="1" stop-color="#fff2cc" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="dome" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#e3a47f"/><stop offset=".45" stop-color="#c07f86"/><stop offset="1" stop-color="#7f6590"/>
  </linearGradient>
  <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f3b3a4"/><stop offset=".35" stop-color="#f6c9bb"/><stop offset=".8" stop-color="#fbece4"/><stop offset="1" stop-color="#fbfaf8"/>
  </linearGradient>
  <linearGradient id="goldL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3b35a"/><stop offset="1" stop-color="#b6a347"/></linearGradient>
  <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bd52"/><stop offset=".5" stop-color="#8fae3e"/><stop offset="1" stop-color="#6f9436"/></linearGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fbfaf8" stop-opacity="0"/><stop offset="1" stop-color="#fbfaf8"/>
  </linearGradient>
  <filter id="paint" x="-5%" y="-20%" width="110%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency=".006 .018" numOctaves="3" seed="7" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="22" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="cloud" x="-20%" y="-50%" width="140%" height="200%">
    <feTurbulence type="fractalNoise" baseFrequency=".005 .02" numOctaves="4" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="70" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feGaussianBlur in="d" stdDeviation="7"/>
  </filter>
  <filter id="soft" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/></filter>
</defs>

<rect width="1600" height="640" fill="url(#sky)"/>
<rect width="1600" height="640" fill="url(#sun)"/>
<g filter="url(#cloud)">${clouds}</g>

<g filter="url(#paint)">
  <path d="M0 520 C120 482 220 470 330 486 S520 452 610 468 S780 430 860 452 S1040 470 1130 450 S1340 470 1440 486 S1560 492 1600 500 L1600 610 L0 610 Z" fill="#c3a0b5" opacity=".75"/>
  <path d="M600 590 C700 520 790 420 880 382 C930 362 975 364 1020 392 C1100 440 1180 520 1290 590 Z" fill="url(#dome)"/>
  <path d="M0 585 C120 540 260 528 400 548 C500 562 560 580 640 596 L0 610 Z" fill="url(#goldL)"/>
  <path d="M1040 598 C1140 560 1260 540 1380 548 C1480 556 1550 566 1600 574 L1600 612 Z" fill="#cda252"/>
</g>

<rect y="592" width="1600" height="408" fill="url(#lake)"/>
<ellipse cx="800" cy="596" rx="900" ry="14" fill="#f7cdb6" filter="url(#soft)"/>
<g opacity=".13" filter="url(#soft)"><path d="M600 596 C700 650 790 730 880 760 C930 776 975 774 1020 752 C1100 714 1180 650 1290 596 Z" fill="#9b7297"/></g>
${streaks}

<g filter="url(#paint)">
  <path d="${poly(leftBank)}" fill="url(#grass)"/>
  <path d="${poly(rightBank)}" fill="url(#grass)"/>
</g>
${meadow(leftBank, [0, 560, 480, 840], 520)}
${meadow(rightBank, [1180, 580, 1600, 760], 360)}

<path d="M1210 318 q9 -7 16 0 q7 -7 16 0" stroke="#5b4a4a" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M1262 300 q6 -5 11 0 q5 -5 11 0" stroke="#5b4a4a" stroke-width="1.6" fill="none" stroke-linecap="round"/>

<rect y="720" width="1600" height="280" fill="url(#fade)"/>
<rect width="1600" height="1000" filter="url(#grain)" opacity=".07"/>
</svg>
`;

writeFileSync(out, svg);
console.log(`paisaje: ${(svg.length / 1024).toFixed(1)} KiB → ${out}`);
