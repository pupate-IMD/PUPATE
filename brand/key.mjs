// Keys out the flat dark background of the user's mark, leaving a transparent line-art PNG cropped
// to its content. Headless Edge + canvas; data URL avoids canvas tainting.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
const outs = process.argv.slice(3); // one or more output paths
const port = 9338;
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const proc = spawn(edge, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`,
  "--user-data-dir=" + process.env.TEMP + "/pupate-cdp-key", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataUrl = "data:image/png;base64," + readFileSync(src).toString("base64");
try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {} await sleep(250); }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r?.result?.value;
  };
  await send("Runtime.enable");
  await ev(`window.__src = ${JSON.stringify(dataUrl)};`);
  const out = await ev(`(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("load")); img.src = window.__src; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const im = g.getImageData(0, 0, W, H); const d = im.data;
    const corner = (x,y) => { const i=(y*W+x)*4; return [d[i],d[i+1],d[i+2]]; };
    const cs = [corner(2,2),corner(W-3,2),corner(2,H-3),corner(W-3,H-3)];
    const bg = [0,1,2].map((k)=>Math.round(cs.reduce((a,p)=>a+p[k],0)/cs.length));
    const t0 = 30, t1 = 90; // distance: fully transparent below t0, opaque above t1
    let minX=W,minY=H,maxX=0,maxY=0;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const i=(y*W+x)*4;
      const dr=d[i]-bg[0], dg=d[i+1]-bg[1], db=d[i+2]-bg[2];
      const dist=Math.sqrt(dr*dr+dg*dg+db*db);
      let a = dist<=t0 ? 0 : dist>=t1 ? 255 : Math.round(255*(dist-t0)/(t1-t0));
      d[i+3]=a;
      if (a>20) { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    g.putImageData(im,0,0);
    const pad=10;
    const sx=Math.max(0,minX-pad), sy=Math.max(0,minY-pad);
    const w=Math.min(W,maxX+pad)-sx, h=Math.min(H,maxY+pad)-sy;
    const oc=document.createElement("canvas"); oc.width=w; oc.height=h;
    oc.getContext("2d").drawImage(c, sx, sy, w, h, 0, 0, w, h);
    return JSON.stringify({ bg, size:[w,h], url: oc.toDataURL("image/png") });
  })()`);
  const res = JSON.parse(out);
  console.log("bg", res.bg, "cropped mark", res.size);
  for (const p of outs) writeFileSync(p, Buffer.from(res.url.split(",")[1], "base64"));
  console.log("wrote", outs.join(", "));
  ws.close();
} finally { proc.kill(); }
