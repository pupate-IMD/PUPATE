"use client";

// Development only: /mine/?gpu-selftest=1 runs the GPU self-test on load, then two seconds of the CPU
// threads for comparison, and writes the result as JSON into <pre id="gpu-selftest"> for
// scripts/gpu-selftest.mjs (headless Edge) to read. The production build leaves it out (Mine.tsx renders
// it only when NODE_ENV is not "production").
import { useEffect, useState } from "react";
import { GpuMiner } from "@/lib/miner/gpu/gpuMiner";
import { type FromWorker, type MinerJob, practiceBitsFor, practiceJob, randomHex, targetWords } from "@/lib/miner/job";

/// One run per page load, even when strict mode mounts the component twice.
let run: Promise<string> | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/// The CPU engine as the page runs it (one worker per spare core), at a difficulty nothing can meet.
async function cpuBenchmark(ms: number): Promise<{ threads: number; rate: number }> {
  const threads = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
  const job: MinerJob = { ...practiceJob(0), ...targetWords(64), bits: 64 };
  const counts = new Array<number>(threads).fill(0);
  const pool = Array.from({ length: threads }, (_, i) => {
    const w = new Worker(new URL("../lib/miner/miner.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === "progress") counts[i] += e.data.hashes;
    };
    w.postMessage({ type: "start", job, nonceHigh: randomHex(32), power: 100, worker: i, chunk: 2000 });
    return w;
  });
  await sleep(1000); // warm-up
  const c0 = counts.reduce((a, b) => a + b, 0);
  const t0 = performance.now();
  await sleep(ms);
  const rate = (counts.reduce((a, b) => a + b, 0) - c0) / ((performance.now() - t0) / 1000);
  for (const w of pool) w.terminate();
  return { threads, rate: Math.round(rate) };
}

/// `benchMs`: the GPU benchmark's length; the page's own self-test takes one second.
async function selfTest(benchMs: number): Promise<string> {
  const t0 = performance.now();
  const probe = await GpuMiner.probe();
  const gpu = probe.ok ? await GpuMiner.selfTest(benchMs) : null;
  const cpu = await cpuBenchmark(2000);
  return JSON.stringify(
    {
      probe,
      gpu: gpu && { ...gpu, rate: Math.round(gpu.rate) },
      practiceBits: gpu?.ok ? practiceBitsFor(gpu.rate) : null,
      cpu,
      gpuOverCpu: gpu?.ok && cpu.rate > 0 ? Math.round((gpu.rate / cpu.rate) * 10) / 10 : null,
      seconds: Math.round((performance.now() - t0) / 100) / 10,
      userAgent: navigator.userAgent,
    },
    null,
    2,
  );
}

export function GpuSelfTestDev() {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("gpu-selftest") !== "1") return;
    let live = true;
    const benchMs = Math.min(60_000, Math.max(1000, Number(q.get("bench")) || 1000));
    run ??= selfTest(benchMs).catch((e: unknown) => JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    void run.then((s) => {
      if (live) setOut(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return out === null ? null : (
    <pre id="gpu-selftest" style={{ marginTop: 28, fontSize: 12, whiteSpace: "pre-wrap", color: "var(--dim)" }}>
      {out}
    </pre>
  );
}
