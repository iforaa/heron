/**
 * Adds a second act to the supplied SVGator Chessrun animation.
 *
 * The source's three-second reveal plays once and freezes. At 3s an exact
 * static reconstruction takes over, allowing a new ball-run performance
 * without fighting the source's existing additive SMIL transforms.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (!input) throw new Error('usage: node examples/extend-chessrun-svg.ts <source.svg> [output.svg]');
const output = process.argv[3] ?? 'out/animated-logo-extended.svg';
const source = readFileSync(input, 'utf8');

function pathTag(id: string): string {
  const tag = source.match(new RegExp(`<path id="${id}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`extend-chessrun-svg: path "${id}" is missing`);
  return tag
    .replace(/\sid="[^"]+"/, '')
    .replace(/\sstroke="#000000"[^>]*stroke-width="0"[^>]*/, '');
}

function pathData(id: string): string {
  const d = pathTag(id).match(/\sd="([^"]+)"/)?.[1];
  if (!d) throw new Error(`extend-chessrun-svg: path data for "${id}" is missing`);
  return d;
}

function finalPathData(id: string): string {
  const animation = source.match(
    new RegExp(`<animate(?=[^>]*href="#${id}")(?=[^>]*attributeName="d")[^>]*>`),
  )?.[0];
  const d = animation?.match(/\sto="([^"]+)"/)?.[1];
  if (!d) throw new Error(`extend-chessrun-svg: final path data for "${id}" is missing`);
  return d;
}

const base = finalPathData('_R_G_L_5_G_D_0_P_0');
const ball = pathData('_R_G_L_4_G_D_0_P_0');
const plate = pathData('_R_G_L_3_G_D_0_P_0');
const run = pathData('_R_G_L_2_G_D_0_P_0');
const runAccent = pathData('_R_G_L_2_G_D_1_P_0');
const chess = pathData('_R_G_L_1_G_D_0_P_0');
const rook = finalPathData('_R_G_L_0_G_D_0_P_0');

const takeover = `
<set xlink:href="#_R_G" attributeName="opacity" to="0" begin="3.001s" fill="freeze"/>
<set xlink:href="#chessrun_continuation" attributeName="opacity" to="1" begin="3s" fill="freeze"/>
`;

const continuation = `
<g id="chessrun_continuation" opacity="0" aria-label="ChessRun animated logo continuation">
  <g id="extended_speed_lines" fill="none" stroke="#f4a54d" stroke-linecap="round">
    <path d="M875 628 H1080" stroke-width="9" opacity="0">
      <animate attributeName="opacity" begin="3.24s" dur="1.2s" values="0;0.85;0" keyTimes="0;0.28;1" fill="freeze"/>
      <animate attributeName="stroke-dasharray" begin="3.24s" dur="1.2s" values="0 205;145 60;0 205" fill="freeze"/>
    </path>
    <path d="M900 650 H1055" stroke-width="6" opacity="0">
      <animate attributeName="opacity" begin="3.32s" dur="1.05s" values="0;0.65;0" keyTimes="0;0.25;1" fill="freeze"/>
      <animate attributeName="stroke-dasharray" begin="3.32s" dur="1.05s" values="0 155;105 50;0 155" fill="freeze"/>
    </path>
    <path d="M930 672 H1035" stroke-width="4" opacity="0">
      <animate attributeName="opacity" begin="3.4s" dur="0.9s" values="0;0.5;0" keyTimes="0;0.24;1" fill="freeze"/>
      <animate attributeName="stroke-dasharray" begin="3.4s" dur="0.9s" values="0 105;65 40;0 105" fill="freeze"/>
    </path>
  </g>

  <g transform="translate(960 707.82)">
    <g id="extended_base_reaction">
      <animateTransform attributeName="transform" type="scale" additive="sum"
        begin="3.2s" dur="2.45s"
        values="1 1;1.035 0.92;0.985 1.035;1 1;1 1"
        keyTimes="0;0.15;0.3;0.48;1"
        keySplines=".2 0 .3 1;.2 0 .3 1;.2 0 .3 1;0 0 1 1"
        calcMode="spline" fill="freeze"/>
      <g transform="translate(-960 -707.82)">
        <g transform="translate(736.62 707.82) scale(5) translate(44.63 0)">
          <path fill="#17191a" d="${base}"/>
        </g>
      </g>
    </g>
  </g>

  <g id="extended_run_reaction">
    <animateTransform attributeName="transform" type="rotate" additive="sum"
      begin="3.2s" dur="2.45s"
      values="0 1090.92 567.34;-5 1090.92 567.34;2.5 1090.92 567.34;0 1090.92 567.34;0 1090.92 567.34"
      keyTimes="0;0.16;0.32;0.5;1"
      keySplines=".2 0 .3 1;.2 0 .3 1;.2 0 .3 1;0 0 1 1"
      calcMode="spline" fill="freeze"/>
    <g transform="translate(1090.92 567.34) scale(5) translate(80.815 113.333)">
      <path fill="#f4a54d" d="${plate}"/>
      <path fill="#ffffff" d="${run}"/>
      <path fill="#f4a54d" d="${runAccent}"/>
    </g>
  </g>

  <g id="extended_chess_reaction">
    <animateTransform attributeName="transform" type="translate" additive="sum"
      begin="3.2s" dur="2.45s"
      values="0 0;-8 -15;5 7;0 0;0 0"
      keyTimes="0;0.16;0.32;0.5;1"
      keySplines=".2 0 .3 1;.2 0 .3 1;.2 0 .3 1;0 0 1 1"
      calcMode="spline" fill="freeze"/>
    <g transform="translate(1109.36 463.29) scale(5) translate(77.127 134.142)">
      <path fill="#17191a" d="${chess}"/>
    </g>
  </g>

  <g id="extended_rook_reaction">
    <animateTransform attributeName="transform" type="translate" additive="sum"
      begin="3.18s" dur="2.45s"
      values="0 0;0 -42;0 9;0 0;0 0"
      keyTimes="0;0.18;0.34;0.52;1"
      keySplines=".15 0 .25 1;.2 0 .3 1;.2 0 .3 1;0 0 1 1"
      calcMode="spline" fill="freeze"/>
    <g transform="translate(958.037 354.56) scale(4.97921)">
      <path fill="#17191a" d="${rook}"/>
    </g>
  </g>

  <g transform="translate(1059.65 643.5)">
    <g id="extended_ball_motion">
      <animateMotion begin="3.25s" dur="2.35s"
        path="M0 0 C85 0 148 -3.5 188 7.5 C265 28.5 258 104.5 182.35 108.5 C105.35 112.5 68.35 -37.5 0 0"
        calcMode="paced" fill="freeze"/>
      <g id="extended_ball_spin" transform="scale(5)">
        <animateTransform attributeName="transform" type="rotate" additive="sum"
          begin="3.25s" dur="2.35s" from="0 0 0" to="720 0 0" fill="freeze"/>
        <path fill="#17191a" d="${ball}"/>
        <circle cx="0" cy="-3.8" r="1.15" fill="#f4a54d"/>
      </g>
    </g>
  </g>
</g>
`;

let result = source.replaceAll('repeatCount="indefinite"', 'repeatCount="1"');
result = result.replace('</defs>', `${takeover}</defs>`);
result = result.replace('<g id="time_group"/>', `${continuation}<g id="time_group"/>`);
result = result
  .replace('width="1920" height="1080"', 'width="720" height="405"')
  .replace('style="width:100%;height:100%"', 'style="display:block;max-width:100%;height:auto"');

writeFileSync(output, result);
console.log(`${output}  original reveal 0–3s, rolling continuation 3–5.6s`);
