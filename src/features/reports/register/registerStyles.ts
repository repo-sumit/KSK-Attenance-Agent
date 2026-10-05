/**
 * The register document's own stylesheet (D-137). The document is a standalone file opened outside the app,
 * so it cannot use the app's CSS Modules or tokens: its palette is the brief's government print palette.
 */
const NAVY = '#12355b';
const SAFFRON = '#e07a1f';
const INK = '#1f2933';
const MUTED = '#5b6675';
const RULE = '#d5dce6';
const PAGE = '#eef1f5';

export const REGISTER_STYLES = `
:root{--navy:${NAVY};--saffron:${SAFFRON};--ink:${INK};--muted:${MUTED};--rule:${RULE};--day:22px;
--serif:"Noto Serif","Tiro Devanagari Marathi",Georgia,"Times New Roman",serif;
--sans:"Montserrat","Mukta","Noto Sans","Noto Sans Devanagari","Segoe UI",Roboto,Arial,sans-serif}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html{background:${PAGE}}
body{margin:0;background:${PAGE};color:var(--ink);font:13px/1.45 var(--sans);-webkit-text-size-adjust:100%}
h1,h2,h3{font-family:var(--serif);color:var(--navy);margin:0;font-weight:700}
.toolbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;
padding:8px 24px;background:#fff;border-bottom:1px solid var(--rule);box-shadow:0 1px 3px rgba(18,53,91,.08)}
.toolbar-title{font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.toolbar button{flex:none;min-height:44px;padding:0 20px;border:0;border-radius:8px;background:var(--navy);color:#fff;
font:600 14px var(--sans);cursor:pointer}
.toolbar button:hover{background:#0c2742}
.toolbar button:focus-visible{outline:3px solid var(--saffron);outline-offset:2px}
main{padding:24px 16px 48px}
.sheet{max-width:1180px;margin:0 auto 24px;padding:32px;background:#fff;border-top:6px solid var(--saffron);
border-radius:2px;box-shadow:0 2px 6px rgba(18,53,91,.08),0 12px 32px rgba(18,53,91,.10)}
.head{display:flex;align-items:center;gap:16px;padding-bottom:14px;border-bottom:2px solid var(--navy)}
.emblem{display:block;width:56px;height:56px;flex:none}
.head-org{flex:1;min-width:0}
.authority{font-variant:small-caps;letter-spacing:.08em;font-size:12px;color:var(--muted);font-weight:600;text-transform:lowercase}
.institute{font-size:22px;line-height:1.2;margin:2px 0}
.inst-line{font-size:12px;color:var(--muted)}
.head-doc{text-align:right;flex:none}
.doc-title{font:700 17px/1.25 var(--serif);color:var(--navy);letter-spacing:.01em}
.doc-month{font-size:15px;font-weight:700;color:var(--ink);margin-top:2px}
.doc-sub{font-size:12px;color:var(--muted)}
.rule-accent{height:2px;background:linear-gradient(90deg,var(--saffron) 0 96px,transparent 96px);margin:3px 0 18px}
.batch-title{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.batch-title h2{font-size:20px}
.year{display:inline-block;padding:2px 10px;border:1px solid var(--saffron);border-radius:999px;color:#8a4a10;
background:#fff6ed;font-size:11.5px;font-weight:600}
.meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0 0 16px;border-top:1px solid var(--rule);border-left:1px solid var(--rule)}
.meta div{padding:7px 12px;border-right:1px solid var(--rule);border-bottom:1px solid var(--rule);min-width:0}
.meta dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
.meta dd{margin:1px 0 0;font-weight:600;overflow-wrap:anywhere}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
.kpi{border:1px solid var(--rule);border-left:4px solid var(--navy);border-radius:4px;padding:10px 14px;min-width:0}
.kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
.kpi-value{font:700 28px/1.15 var(--serif);color:var(--navy);font-variant-numeric:tabular-nums;margin:2px 0}
.kpi-sub{font-size:11.5px;color:var(--muted)}
.kpi.warn{border-left-color:#c27a00}
.kpi.warn .kpi-value{color:#9a5b00}
.kpi.warn .kpi-sub{color:#9a5b00;font-weight:600}
.reg-wrap{overflow-x:auto;border:1px solid var(--rule);border-radius:2px;-webkit-overflow-scrolling:touch}
table{border-collapse:separate;border-spacing:0}
.reg{width:100%;table-layout:fixed;min-width:calc(190px + var(--days) * var(--day) + 240px);font-size:11px;font-variant-numeric:tabular-nums}
.reg col.k-no{width:24px}.reg col.k-roll{width:34px}.reg col.k-day{width:var(--day)}
.reg col.k-fig{width:42px}.reg col.k-pct{width:36px}.reg col.k-rmk{width:76px}
.reg th,.reg td{border-right:1px solid #e3e8ef;border-bottom:1px solid #e3e8ef;padding:0;text-align:center;vertical-align:middle;height:26px}
.reg thead th{background:var(--navy);color:#fff;font-weight:600;border-color:#2c4b70}
.reg thead .h1 th{padding:5px 2px 2px;font-size:10.5px}
.reg thead .h2 th{padding:1px 0 4px;font-size:9px;font-weight:500;color:#c8d4e3;height:auto}
.reg thead th.l{text-align:left;padding-left:6px}
.reg thead th.sun{background:#3f5672}
.reg thead th.pend{box-shadow:inset 0 -3px 0 var(--saffron)}
.reg .sticky{position:sticky;z-index:1;background:#fff}
.reg thead .sticky{z-index:2;background:var(--navy)}
.reg .k1{left:0}.reg .k2{left:24px}.reg .k3{left:58px}
.reg .name{text-align:left;padding:3px 6px;line-height:1.25;border-right:2px solid #c9d3df}
.reg thead th.name{border-right-color:#2c4b70}
.nm{display:block;font-weight:600;overflow-wrap:anywhere}
.fa{display:block;font-size:9.5px;color:#7a8594;overflow-wrap:anywhere}
.reg .num{color:var(--muted)}
.reg td.c{font-weight:700;font-size:10.5px;white-space:nowrap}
.reg td.fig{font-weight:600}
.reg td.f-pct{font-weight:800;color:var(--navy)}
.reg td.rmk{font-size:10px;font-weight:600;color:#7a8594;padding:0 4px;text-align:left}
.reg td.rmk.ok{color:#1b7a3d}
.reg td.rmk.risk{color:#9a5b00}
.reg tr.risk>td,.reg tr.risk>td.sticky{background:#fff6e5}
.reg tr>td.sun,.reg tr>td.none{background:#f3f4f6}
.reg tr>td.up{background:repeating-linear-gradient(135deg,#fff 0 3px,#eef1f4 3px 5px)}
.reg tr>td.pend{box-shadow:inset 1.5px 0 0 var(--saffron),inset -1.5px 0 0 var(--saffron)}
.reg tr>td.s-p{color:#1b7a3d}
.reg tr>td.s-a{color:#b42318;background:#fdecea}
.reg tr>td.s-l{color:#1d4ed8;background:#e8eefc}
.reg tr>td.s-h,.reg tr>td.s-m{color:#9a5b00;background:#fff4dc}
.reg tr>td.s-o{color:#5b3fa0}
.reg tr>td.s-o,.reg tr>td.s-m{font-size:8.5px}
.star{font-size:8px;color:var(--saffron);margin-left:1px;vertical-align:super;line-height:0}
.reg tfoot td,.reg tfoot th{background:#f4f6fa;font-weight:700;color:var(--navy);border-top:2px solid var(--navy);font-size:10px}
.reg tfoot th{text-align:left;padding-left:6px}
.reg tfoot .sticky{background:#f4f6fa}
.empty{margin:0 0 10px;padding:8px 12px;background:#f4f6fa;border-left:3px solid var(--muted);color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin:12px 0 4px;font-size:11px;color:var(--muted)}
.legend-title{font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.06em;font-size:10.5px}
.legend span.item{display:inline-flex;align-items:center;gap:5px}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:18px;padding:0 4px;border:1px solid #e3e8ef;
border-radius:3px;font-weight:700;font-size:10px;background:#fff}
.chip.s-p{color:#1b7a3d}.chip.s-a{color:#b42318;background:#fdecea}.chip.s-l{color:#1d4ed8;background:#e8eefc}
.chip.s-h,.chip.s-m{color:#9a5b00;background:#fff4dc}.chip.s-o{color:#5b3fa0}.chip.none{background:#f3f4f6;color:#9aa3af}
.chip.up{background:repeating-linear-gradient(135deg,#fff 0 3px,#eef1f4 3px 5px)}
.chip.pend{border:1.5px solid var(--saffron)}
.chip.star-chip{color:var(--saffron)}
.how{margin:2px 0 0;font-size:11px;color:var(--muted)}
h3{font-size:14px;margin:20px 0 8px}
.plain{width:100%;font-size:11.5px;border:1px solid var(--rule)}
.plain th{background:#f4f6fa;color:var(--navy);text-align:left;font-weight:700;padding:6px 8px;border-bottom:1px solid var(--rule);font-size:10.5px;
text-transform:uppercase;letter-spacing:.04em}
.plain td{padding:6px 8px;border-bottom:1px solid #edf0f4;vertical-align:top;overflow-wrap:anywhere}
.plain tr:last-child td{border-bottom:0}
.plain .n{text-align:right;font-variant-numeric:tabular-nums}
.plain .low{color:#9a5b00;font-weight:700}
.plain .warn{color:#9a5b00;font-weight:700}
.tbl-wrap{overflow-x:auto}
.sign{display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:32px;align-items:start;margin:36px 0 8px}
.sign-block{padding-top:40px;border-bottom:1px solid var(--ink);position:relative}
.sign-cap{margin-top:6px;font-size:11.5px;color:var(--muted)}
.sign-cap b{display:block;color:var(--ink);font-size:12px}
.sign-date{font-size:12px;color:var(--ink);white-space:nowrap;padding-top:30px}
.foot{margin-top:18px;padding-top:8px;border-top:1px solid var(--rule);font-size:10.5px;color:var(--muted);display:flex;flex-wrap:wrap;
justify-content:space-between;gap:4px 16px}
.sample{color:#8a4a10;font-weight:700}
.summary-meta{margin:0 0 14px;color:var(--muted);font-size:12px}
@media (max-width:699px){
main{padding:12px 8px 32px}
.toolbar{padding:6px 12px}
.toolbar button{padding:0 14px;font-size:13px}
.sheet{padding:18px 14px 16px;margin-bottom:12px}
.head{flex-wrap:wrap;align-items:flex-start;gap:8px 12px}
.emblem{width:48px;height:48px}
.head-doc{flex-basis:100%;text-align:left}
.institute{font-size:19px}
.meta{grid-template-columns:repeat(2,minmax(0,1fr))}
.kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.kpi-value{font-size:24px}
.reg{min-width:calc(170px + var(--days) * 24px + 240px)}
.reg col.k-day{width:24px}
.sign{grid-template-columns:1fr;gap:20px}
.plain{min-width:520px}
}
@page{size:A4 landscape;margin:10mm}
@media print{
:root{--day:20px}
html,body{background:#fff}
body{font-size:10.5px}
.toolbar{display:none}
main{padding:0}
.sheet{max-width:none;margin:0;padding:0;box-shadow:none;border-top-width:5px;border-radius:0}
.sheet+.sheet{break-before:page}
.head{padding:6px 0 8px}
.rule-accent{margin-bottom:10px}
.kpis{margin-bottom:10px}.kpi{padding:6px 10px}.kpi-value{font-size:20px}
.meta{margin-bottom:10px}.meta div{padding:4px 8px}
.reg-wrap{overflow:visible;border:0}
.reg{min-width:0;font-size:9px;border-top:1px solid #2c4b70;border-left:1px solid #e3e8ef}
.reg col.k-no{width:18px}.reg col.k-roll{width:26px}.reg col.k-fig{width:34px}.reg col.k-pct{width:28px}.reg col.k-rmk{width:62px}
.reg th,.reg td{height:19px}
.reg td.c{font-size:8.5px}.reg tr>td.s-o,.reg tr>td.s-m{font-size:7px}
.reg thead .h1 th{font-size:8.5px;padding:3px 1px 1px}.reg thead .h2 th{font-size:7.5px}
.reg .sticky{position:static}
.reg .name{padding:1px 4px;line-height:1.12}.fa{font-size:7.5px}.nm{font-size:9px}
.sign{margin:18px 0 4px}.sign-block{padding-top:30px}.sign-date{padding-top:20px}.foot{margin-top:10px}.legend{margin-top:8px}
.reg td.rmk{font-size:8px}
thead{display:table-header-group}
tfoot{display:table-row-group}
tr,.kpis,.legend,.sign,.foot,.head{break-inside:avoid}
.tbl-wrap{overflow:visible}
.plain{min-width:0}
h3{break-after:avoid}
}
`;
