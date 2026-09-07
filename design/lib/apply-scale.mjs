// Round-two scale system, applied once to the shared token layer.
//
// Hard rules:
//   no customer-facing text below 12px
//   no functional text (label, button, tab, filter, link, status, help) below 13px
//   dense icon controls >= 32x32, standard controls 36px, primary 40-44px,
//   inputs 40px, sidebar rows 36-40px, tabs 40-44px
import { readFileSync, writeFileSync } from "node:fs";

const p = "design/head.part";
let s = readFileSync(p, "utf8");
const swap = (a, b) => {
  if (!s.includes(a)) throw new Error("no match: " + a.slice(0, 70));
  s = s.split(a).join(b);
};

/* ---------------------------------------------------------------- type --- */
swap(
  `    .m { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 12.5px; }`,
  `    .m { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 13px; line-height: 19px; }`,
);

swap(
  `    .lab { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 11.5px; letter-spacing: .01em; color: var(--faint); }`,
  `    /* .lab is the optional-metadata floor at 12px. Functional labels use
       .lab-fn at 13px. Nothing customer-facing goes below 12px. */
    .lab { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 12px; line-height: 18px; letter-spacing: .01em; color: var(--faint); }
    .lab-fn { font-size: 13px; line-height: 19px; }`,
);

swap(
  `    .h2 { font-size: 15px; line-height: 21px; font-weight: 600; margin: 0; }
    .h3 { font-size: 14px; line-height: 20px; font-weight: 600; margin: 0; }`,
  `    .h2 { font-size: 16px; line-height: 22px; font-weight: 600; margin: 0; }
    .h3 { font-size: 15px; line-height: 22px; font-weight: 600; margin: 0; }
    .h-sec { font-size: 18px; line-height: 26px; font-weight: 600; margin: 0; }`,
);

swap(
  `      font-size: 14px; line-height: 20px; -webkit-font-smoothing: antialiased;`,
  `      font-size: 14px; line-height: 21px; -webkit-font-smoothing: antialiased;`,
);

swap(
  `    a { color: var(--acc-text); text-decoration: none; }
    a:hover { text-decoration: underline; }`,
  `    a { color: var(--acc-text); text-decoration: none; }
    a:hover { text-decoration: underline; }
    /* A standalone link is a control and needs a hit area. Links inside a
       paragraph keep the paragraph line-height and are exempt. */
    a.link, .stack > a, .mfoot-nav a, .mhead [data-nav] a {
      display: inline-flex; align-items: center; min-height: 36px; font-size: 14px; }`,
);

/* ------------------------------------------------------------ controls --- */
swap(
  `    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      height: 32px; padding: 0 13px; border: 1px solid var(--line-strong); background: var(--raised);
      border-radius: 7px; font-size: 13px; color: var(--fg); white-space: nowrap;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }`,
  `    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 36px; padding: 0 14px; border: 1px solid var(--line-strong); background: var(--raised);
      border-radius: 8px; font-size: 14px; line-height: 20px; color: var(--fg); white-space: nowrap;
      transition: background 140ms ease, border-color 140ms ease, color 140ms ease; }`,
);

swap(
  `    .btns { height: 28px; padding: 0 10px; font-size: 12.5px; border-radius: 6px; }
    .btnl { height: 38px; padding: 0 18px; font-size: 14px; border-radius: 8px; }
    .ico { width: 32px; padding: 0; }
    .ico.btns { width: 28px; }`,
  `    /* dense variant: 32px, never 28 */
    .btns { height: 32px; padding: 0 12px; font-size: 13px; border-radius: 7px; }
    .btnl { height: 42px; padding: 0 20px; font-size: 15px; border-radius: 9px; }
    .ico { width: 36px; padding: 0; }
    .ico.btns { width: 32px; }`,
);

swap(
  `    .pill { display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px;
      border-radius: 11px; border: 1px solid var(--line); background: transparent;
      font-size: 11.5px; color: var(--mut); white-space: nowrap; }`,
  `    /* a pill is a status badge */
    .pill { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
      border-radius: 12px; border: 1px solid var(--line); background: transparent;
      font-size: 12.5px; color: var(--mut); white-space: nowrap; }
    /* a pill that is a control gets a control's hit area */
    button.pill, a.pill { height: 36px; border-radius: 18px; padding: 0 14px; font-size: 13px;
      color: var(--fg); cursor: pointer; }`,
);

swap(
  `    .field { height: 34px; border: 1px solid var(--line); background: var(--sunk);
      border-radius: 7px; display: flex; align-items: center; gap: 9px; padding: 0 11px;
      font-size: 13px; color: var(--mut); }`,
  `    .field { height: 40px; border: 1px solid var(--line); background: var(--sunk);
      border-radius: 8px; display: flex; align-items: center; gap: 10px; padding: 0 12px;
      font-size: 14px; color: var(--mut); }
    .field:focus-within { border-color: var(--acc); }
    .field input { border: 0; background: transparent; outline: none; flex: 1; min-width: 0;
      color: var(--fg); font-size: 14px; }`,
);

swap(
  `    .srow { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 9px;
      border-radius: 7px; font-size: 13.5px; color: var(--mut); cursor: pointer;
      transition: background 140ms ease, color 140ms ease; width: 100%; text-align: left; }`,
  `    .srow { display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 4px 10px;
      border-radius: 8px; font-size: 14px; color: var(--mut); cursor: pointer;
      transition: background 140ms ease, color 140ms ease; width: 100%; text-align: left; }`,
);

swap(
  `    .sgroup { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 11px; color: var(--faint); padding: 0 9px; height: 26px;
      display: flex; align-items: center; letter-spacing: .02em; }`,
  `    .sgroup { font-family: "Geist Mono", "Cascadia Mono", ui-monospace, Consolas, monospace;
      font-size: 12px; color: var(--faint); padding: 0 10px; height: 30px;
      display: flex; align-items: center; letter-spacing: .02em; }`,
);

swap(
  `    .topbar { height: 48px; flex-shrink: 0; display: flex; align-items: center; gap: 10px;
      padding: 0 12px 0 10px; border-bottom: 1px solid var(--line-soft); }`,
  `    .topbar { height: 52px; flex-shrink: 0; display: flex; align-items: center; gap: 10px;
      padding: 0 16px 0 12px; border-bottom: 1px solid var(--line-soft); }`,
);

swap(
  `    .col { width: 100%; max-width: 792px; margin: 0 auto; padding: 0 24px; }`,
  `    .col { width: 100%; max-width: 792px; margin: 0 auto; padding: 0 28px; }`,
);

/* ------------------------------------------------------------- composer -- */
swap(
  `    .composer .ph { font-size: 15px; line-height: 22px; color: var(--mut); min-height: 22px; }
    .cbar { display: flex; align-items: center; gap: 6px; }`,
  `    .cbar { display: flex; align-items: center; gap: 8px; }`,
);
swap(
  `    textarea.ta { width: 100%; border: 0; background: transparent; resize: none;
      font-size: 15px; line-height: 22px; color: var(--fg); outline: none;
      min-height: 22px; max-height: 200px; padding: 0; font-family: inherit; }`,
  `    textarea.ta { width: 100%; border: 0; background: transparent; resize: none;
      font-size: 15px; line-height: 22px; color: var(--fg); outline: none;
      min-height: 44px; max-height: 220px; padding: 0; font-family: inherit; }`,
);

/* ------------------------------------------------------- activity rows --- */
swap(
  `    .act > .hd { display: flex; align-items: center; gap: 9px; height: 36px; padding: 0 12px; }
    .arow { display: flex; align-items: center; gap: 10px; min-height: 30px; padding: 4px 12px;
      font-size: 13px; color: var(--mut); }`,
  `    .act > .hd { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 16px; }
    .arow { display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 6px 16px;
      font-size: 14px; color: var(--mut); }`,
);

/* --------------------------------------------------------------- tables -- */
swap(
  `    .tbl { width:100%; border-collapse:collapse; font-size:13.5px; }
    .tbl th, .tbl td { text-align:left; padding:11px 14px; border-bottom:1px solid var(--line-soft); }
    .tbl thead th { font-family:"Geist Mono","Cascadia Mono",ui-monospace,Consolas,monospace;
      font-size:11.5px; color:var(--faint); font-weight:400; background:var(--panel); }`,
  `    .tbl { width:100%; border-collapse:collapse; font-size:14px; }
    .tbl th, .tbl td { text-align:left; padding:14px 16px; border-bottom:1px solid var(--line-soft); }
    .tbl thead th { font-family:"Geist Mono","Cascadia Mono",ui-monospace,Consolas,monospace;
      font-size:13px; color:var(--faint); font-weight:400; background:var(--panel); }`,
);

/* ------------------------------------------------------------ marketing -- */
swap(`    .mhead-in { height:68px; display:flex; align-items:center; gap:20px; }`,
     `    .mhead-in { height:72px; display:flex; align-items:center; gap:22px; }`);
swap(`    .mhead [data-nav] a { color:var(--mut); font-size:13.5px; }`,
     `    .mhead [data-nav] a { color:var(--mut); font-size:14px; font-weight:500; }`);
swap(`    .mfoot-nav a { color:var(--mut); font-size:13px; }`,
     `    .mfoot-nav a { color:var(--mut); font-size:14px; }`);
swap(
  `    .mlede { margin:0; font-size:17px; line-height:27px; color:var(--mut); max-width:62ch; }`,
  `    .mlede { margin:0; font-size:17px; line-height:27px; color:var(--mut); max-width:62ch; }
    .mbody { font-size:16px; line-height:26px; }
    .msmall { font-size:13px; line-height:20px; }`,
);
swap(
  `    .mhero h1 { margin:0; font-size:clamp(38px,5.2vw,60px); line-height:1.04;
      font-weight:600; letter-spacing:-.028em; max-width:15ch; }`,
  `    .mhero h1 { margin:0; font-size:clamp(40px,4.4vw,60px); line-height:1.03;
      font-weight:600; letter-spacing:-.028em; max-width:15ch; }`,
);
swap(
  `    .mh2 { margin:0; font-size:clamp(28px,3.2vw,40px); line-height:1.1; font-weight:600;
      letter-spacing:-.022em; }`,
  `    .mh2 { margin:0; font-size:clamp(32px,3vw,40px); line-height:1.12; font-weight:600;
      letter-spacing:-.022em; }
    .mh1 { margin:0; font-size:clamp(36px,3.6vw,48px); line-height:1.14; font-weight:600;
      letter-spacing:-.024em; }`,
);

writeFileSync(p, s);
console.log("scale system applied to head.part");
