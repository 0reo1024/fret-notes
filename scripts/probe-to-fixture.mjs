// Converts an audio-live-probe report into a test fixture: analysis values only (no audio, no device names).
// Usage: node scripts/probe-to-fixture.mjs <report.json> <out.json> "<source description>" '<json notes, e.g. {"targets":[40]}>'
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, source, extra = '{}'] = process.argv.slice(2);
if (!input || !output || !source) {
  console.error('usage: node scripts/probe-to-fixture.mjs <report.json> <out.json> "<source>" [json]');
  process.exit(1);
}
const report = JSON.parse(readFileSync(input, 'utf8').replace(/^﻿/, ''));
const timeline = report.timeline
  .filter(o => o.state !== 'stopped')
  .map(o => ({ audioTimeMs: o.audioTimeMs, state: o.state, frequency: o.frequency, levelDb: Math.round(o.levelDb * 10) / 10 }));
writeFileSync(output, JSON.stringify({ source, ...JSON.parse(extra), timeline }, null, 2) + '\n');
console.log(`${output}: ${timeline.length} observations`);
