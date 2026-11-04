import { $ } from '../../ui/dom';
import {
  bpmBand, calibrate, describeTendency, expectedOnsets, judgeHits, metronomeClicks, patterns, summary, transform,
  type RhythmHit, type RhythmPattern, type Transform,
} from '../../domain/training/rhythm';
import type { TrainingRepository } from '../../platform/training-store';
import { ClickScheduler, sound } from '../../platform/sound';
import type { ProfileId } from '../../domain/instruments/profiles';
import { InputClock } from '../../domain/training/timeline';
import type { AudioObservation } from '../../platform/audio';
import type { SettingsRepository } from '../../platform/settings';
import type { AudioConsumer, AudioHub } from '../audio/hub';
import type { mountTuner } from '../tuner/view';

type ClickMode = 'all' | 'backbeat' | 'one' | 'none';
type Method = 'tap' | 'play';
interface RhythmPreferences { patternId: string; transform: Transform; bpm: number; bars: number; click: ClickMode; swing: number; volume: number; method: Method }
const beatsPerBar = 4, calibrationClicks = 16, calibrationBpm = 90;
/** Keys a foot switch or keyboard may send for a tap. */
const tapKeys = ['Space', 'Enter', 'NumpadEnter', 'PageDown', 'ArrowRight', 'KeyF', 'KeyJ'];
function decodePreferences(input: unknown): RhythmPreferences {
  const value = (input && typeof input === 'object' ? input : {}) as Partial<RhythmPreferences>;
  const pick = <T,>(candidate: unknown, allowed: readonly T[], fallback: T) => allowed.includes(candidate as T) ? candidate as T : fallback;
  const within = (v: unknown, low: number, high: number, fallback: number) => typeof v === 'number' && v >= low && v <= high ? v : fallback;
  return {
    patternId: pick(value.patternId, patterns.map(p => p.id), 'quarters'), transform: pick(value.transform, ['none', 'shift', 'double', 'half'] as const, 'none'),
    bpm: Math.round(within(value.bpm, 40, 200, 80)), bars: pick(value.bars, [2, 4, 8], 2), click: pick(value.click, ['all', 'backbeat', 'one', 'none'] as const, 'all'),
    swing: within(value.swing, .5, .75, .5), volume: within(value.volume, 0, 1, .6), method: pick(value.method, ['tap', 'play'] as const, 'tap'),
  };
}

/** Rhythm by tapping or by playing: the app counts in and clicks, the player taps (or picks the guitar), and every hit is matched to the grid.
 * Played hits come from the input's onsets, mapped from the capture clock onto the performance clock. */
export function mountRhythm(training: TrainingRepository, instrument: () => ProfileId, audio: { repository: SettingsRepository; hub: AudioHub; tuner: ReturnType<typeof mountTuner> }) {
  const { repository, hub, tuner } = audio, controller = hub.controller, inputClock = new InputClock();
  let prefs = decodePreferences(training.preference('rhythm'));
  let visible = false, mode: 'idle' | 'running' | 'calibrating' | 'done' = 'idle', t0 = 0, endMs = 0, scheduler: ClickScheduler | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let taps: number[] = [], expected: { timeMs: number; accent: boolean }[] = [], hits: RhythmHit[] | null = null, clicks: number[] = [], feedback = '', frame: number | null = null;
  /** Focused practice sets the pattern, tempo and method of a weak item; those are never saved, the rest of the settings are. */
  let focus: { label: string; restore: Pick<RhythmPreferences, 'patternId' | 'bpm' | 'method' | 'transform'> } | null = null;
  const save = () => training.updatePreferences('rhythm', focus ? { ...prefs, ...focus.restore } : prefs);
  function endFocus() { if (!focus) return; prefs = { ...prefs, ...focus.restore }; focus = null; }
  const text = (selector: string, value: string) => { const element = $(selector); if (element.textContent !== value) element.textContent = value; };
  const current = (): RhythmPattern | null => transform(patterns.find(p => p.id === prefs.patternId)!, prefs.transform);
  const offset = () => prefs.method === 'tap' ? training.current.calibration.tapOffsetMs : training.current.calibration.inputOffsetMs;
  const setOffset = (value: number | null) => training.updateCalibration(prefs.method === 'tap' ? { tapOffsetMs: value } : { inputOffsetMs: value });
  const beatMs = () => 60000 / prefs.bpm;
  const swings = (p: RhythmPattern) => p.subdivision === 2 || p.subdivision === 4;

  function stopClock() {
    scheduler?.stop(); scheduler = null;
    if (timer) clearTimeout(timer); timer = null;
    if (frame !== null) cancelAnimationFrame(frame); frame = null;
    sound.suspend();
  }
  /** Starts the click track on the audio clock and remembers where its zero lies on the performance clock. */
  function clock(totalBeats: number, countInBeats: number, click: ClickMode, bpm: number) {
    const context = sound.ensure(); sound.setVolume(prefs.volume);
    const startAt = context.currentTime + .3, ms = 60000 / bpm;
    t0 = sound.toPerformanceTime(startAt);
    scheduler = new ClickScheduler(sound, startAt, (from, to) => metronomeClicks(ms, beatsPerBar, countInBeats, totalBeats, click, from, to)); scheduler.start();
  }
  function start() {
    const pattern = current();
    if (!pattern) { feedback = 'この変形は、このパターンには使えません'; render(); return; }
    stopClock();
    const countIn = beatsPerBar * beatMs(), bars = Math.max(1, Math.round(prefs.bars * beatsPerBar / pattern.beats));
    expected = expectedOnsets(pattern, prefs.bpm, countIn, bars, swings(pattern) ? prefs.swing : .5);
    const totalBeats = pattern.beats * bars; endMs = countIn + totalBeats * beatMs();
    taps = []; hits = null; feedback = ''; mode = 'running';
    listen();
    clock(totalBeats, beatsPerBar, prefs.click, prefs.bpm);
    timer = setTimeout(finish, endMs + 600 + Math.max(0, t0 - performance.now()));
    tick(); render();
  }
  function finish() {
    stopClock();
    if (mode !== 'running') return;
    hits = judgeHits(expected, taps); mode = 'done';
    const s = summary(hits), pattern = current()!;
    const result = s.accuracy === 1 && s.extra === 0 ? 'correct' as const : 'wrong' as const;
    training.add({ itemId: `${prefs.method === 'tap' ? 'rhy' : 'rhyplay'}:${pattern.id}:${bpmBand(prefs.bpm)}`, layer: 'performance', trainer: 'rhythm', method: prefs.method, result, responseMs: null, instrument: instrument(),
      ...(result === 'wrong' ? { errorKind: `early:${s.early},late:${s.late},missed:${s.missed},extra:${s.extra}` } : {}) });
    feedback = result === 'correct' ? '<span class="is-right">すべての音が許容範囲に入りました</span>' : '';
    render();
  }
  /** Sixteen clicks at 90 BPM: the median of (tap − click) is the whole chain's delay, from output to finger to key. */
  function startCalibration() {
    stopClock();
    const ms = 60000 / calibrationBpm;
    clicks = Array.from({ length: calibrationClicks }, (_, i) => i * ms); taps = []; hits = null; mode = 'calibrating'; feedback = '';
    listen();
    clock(calibrationClicks, 0, 'all', calibrationBpm);
    timer = setTimeout(() => {
      stopClock(); mode = 'idle';
      const value = calibrate(clicks, taps);
      if (value === null) feedback = `<span class="is-wrong">${prefs.method === 'tap' ? 'タップ' : '検出した音'}が足りませんでした。クリックに合わせて16回${prefs.method === 'tap' ? 'タップ' : '弾いて'}ください</span>`;
      else { setOffset(value); feedback = `補正値を ${value} ms にしました${Math.abs(value) > 150 ? '（大きい値です。Bluetooth のイヤホンなど遅延の大きい出力ではないか確認してください）' : ''}`; }
      render();
    }, calibrationClicks * ms + 600 + Math.max(0, t0 - performance.now()));
    render();
  }
  /** Event timestamps share the performance clock, so taps are exact to the event, not to when the code runs. */
  function tap(timeStamp: number) {
    if ((mode !== 'running' && mode !== 'calibrating') || prefs.method !== 'tap') return;
    hit(timeStamp);
  }
  function hit(performanceMs: number) {
    const t = performanceMs - t0 - (mode === 'running' ? offset() ?? 0 : 0);
    if (mode === 'running' && t < beatsPerBar * beatMs() - 300) return;
    taps.push(t);
    const pad = $('#rhythm-pad'); pad.classList.add('is-hit'); setTimeout(() => pad.classList.remove('is-hit'), 80);
  }
  function tick() {
    frame = null;
    if (mode !== 'running' || !visible) return;
    renderGrid();
    frame = requestAnimationFrame(tick);
  }
  function stop() { stopClock(); if (mode === 'running' || mode === 'calibrating') { mode = 'idle'; feedback = '停止しました'; } render(); }
  /** Play mode opens the input before the count-in so the clock mapping has settled by the first beat. */
  function listen() {
    if (prefs.method !== 'play') return;
    inputClock.reset();
    if (controller.phase === 'idle') { repository.updateAudio(repository.current.audio); void controller.start(repository.current.audio); }
  }
  const consumer: AudioConsumer = {
    consume(o: AudioObservation) {
      if (prefs.method !== 'play' || controller.phase !== 'running') return;
      inputClock.observe(performance.now(), o.audioTimeMs);
      if (mode !== 'running' && mode !== 'calibrating') return;
      for (const onset of o.onsets ?? []) hit(inputClock.toPerformance(onset.audioTimeMs) ?? performance.now());
    },
    sync() { if (controller.phase === 'error' && (mode === 'running' || mode === 'calibrating')) { stop(); feedback = `入力が中断しました：${controller.error}`; render(); } },
    pause() { /* Onsets carry their own times; nothing to drop. */ },
  };
  const owner = {
    onStart(settings: Parameters<typeof controller.start>[0]) { repository.updateAudio(settings); void controller.start(settings); },
    onStop() { stop(); void controller.stop(); },
    onChange() { render(); },
  };
  function attachAudio() {
    const on = visible && prefs.method === 'play';
    $('#rhythm-audio').hidden = !on;
    if (on) { tuner.audio.attach($('#rhythm-audio')); tuner.setAudioOwner(owner); hub.setActiveConsumer(consumer); if (!tuner.audio.loaded) void tuner.audio.refreshDevices(); }
    else if (hub.activeConsumer === consumer) { tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); }
  }
  hub.onChange(() => { if (visible && prefs.method === 'play') render(); });

  function renderGrid() {
    const pattern = current(), grid = $('#rhythm-grid');
    if (!pattern) { grid.replaceChildren(); return; }
    const bars = mode === 'idle' ? Math.max(1, Math.round(beatsPerBar / pattern.beats) || 1) : Math.max(1, Math.round(prefs.bars * beatsPerBar / pattern.beats));
    const now = performance.now() - t0, countIn = beatsPerBar * beatMs();
    const byExpected = new Map<number, RhythmHit>(); for (const h of hits ?? []) if (h.expectedMs !== null) byExpected.set(Math.round(h.expectedMs), h);
    let noteIndex = 0;
    const rows: HTMLElement[] = [];
    for (let bar = 0; bar < bars; bar++) {
      const row = document.createElement('div'); row.className = 'rhythm-bar';
      for (let beat = 0; beat < pattern.beats; beat++) {
        const box = document.createElement('div'); box.className = 'rhythm-beat';
        for (let i = 0; i < pattern.subdivision; i++) {
          const cell = pattern.cells[beat * pattern.subdivision + i], element = document.createElement('div');
          element.className = `rhythm-cell${cell === 'accent' ? ' is-accent' : ''}`;
          element.textContent = cell === 'rest' ? '' : cell === 'accent' ? '●' : '•';
          const start = countIn + (bar * pattern.beats + beat + i / pattern.subdivision) * beatMs(), end = start + beatMs() / pattern.subdivision;
          if (mode === 'running' && now >= start && now < end) element.classList.add('is-now');
          if (cell !== 'rest') {
            const hit = expected[noteIndex] ? byExpected.get(Math.round(expected[noteIndex].timeMs)) : undefined; noteIndex++;
            if (hit) { element.classList.add(`v-${hit.verdict}`); if (hit.offsetMs !== null) { const small = document.createElement('small'); small.textContent = `${hit.offsetMs > 0 ? '+' : ''}${Math.round(hit.offsetMs)}`; element.append(small); } }
          }
          box.append(element);
        }
        row.append(box);
      }
      rows.push(row);
    }
    grid.replaceChildren(...rows);
  }
  function render() {
    if (!visible) return;
    renderSettings();
    $('#rhythm-focus').hidden = !focus; $('#rhythm-focus-text').textContent = focus ? `苦手を練習中：${focus.label}（パターン・テンポ・方法は保存しません）` : '';
    const pattern = current(), count = mode === 'running' ? performance.now() - t0 < beatsPerBar * beatMs() : false;
    text('#rhythm-title', pattern ? pattern.name : 'このパターンには使えない変形です');
    text('#rhythm-subtitle', pattern ? `${prefs.bpm} BPM · ${prefs.bars}小節${swings(pattern) && prefs.swing !== .5 ? ` · スウィング ${Math.round(prefs.swing * 100)}%` : ''}` : '');
    text('#rhythm-progress', mode === 'running' ? (count ? 'カウント中…' : 'タップしてください') : mode === 'calibrating' ? `補正中：クリックに合わせて${calibrationClicks}回タップ` : '');
    let summaryHtml = '';
    if (hits && mode === 'done') {
      const s = summary(hits);
      summaryHtml = `<span class="answer-main">${Math.round(s.accuracy * 100)}%</span><span class="answer-detail">ぴったり ${s.tight} · 許容 ${s.ok} · 早い ${s.early} · 遅い ${s.late} · 抜け ${s.missed} · 余分 ${s.extra}${s.meanMs !== null ? ` ／ 平均のずれ ${s.meanMs > 0 ? '+' : ''}${Math.round(s.meanMs)} ms（${describeTendency(s.meanMs)}）` : ''}${s.sdMs !== null ? ` · ばらつき ${Math.round(s.sdMs)} ms` : ''}${offset() === null ? ' ／ 未補正' : ''}</span>`;
    }
    $('#rhythm-feedback').innerHTML = `${summaryHtml}<span class="answer-detail">${feedback}</span>`;
    text('#rhythm-status', mode === 'idle' && offset() === null ? `未補正です。「遅延を補正する」を一度行うと、ずれの数値が正確になります${prefs.method === 'play' ? '（演奏では、ミュートした弦をピッキングして補正します）' : ''}` : mode === 'idle' || mode === 'done' ? (prefs.method === 'tap' ? 'Space で開始。開始後は Space・Enter・画面のタップで打ちます' : 'Space で開始。開始後はギターで弾きます（音の立ち上がりで判定し、音の高さは問いません）') : '');
    $('#rhythm-pad').hidden = prefs.method !== 'tap';
    if (prefs.method === 'play') tuner.audio.render({ startBlocked: false, startLabel: '入力を開始', stopLabel: '停止', lockReference: true });
    $<HTMLButtonElement>('#rhythm-primary').textContent = mode === 'done' ? 'もう一度' : '開始';
    $<HTMLButtonElement>('#rhythm-primary').disabled = mode === 'running' || mode === 'calibrating';
    $<HTMLButtonElement>('#rhythm-calibrate').disabled = mode === 'running' || mode === 'calibrating';
    $<HTMLButtonElement>('#rhythm-stop').disabled = !(mode === 'running' || mode === 'calibrating');
    renderGrid();
  }
  const option = (value: string, label: string) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
  function renderSettings() {
    const select = $<HTMLSelectElement>('#rhythm-pattern');
    if (!select.options.length) select.replaceChildren(...patterns.map(p => option(p.id, p.name)));
    select.value = prefs.patternId; $<HTMLSelectElement>('#rhythm-transform').value = prefs.transform;
    $<HTMLInputElement>('#rhythm-bpm').value = String(prefs.bpm); $<HTMLSelectElement>('#rhythm-bars').value = String(prefs.bars);
    $<HTMLSelectElement>('#rhythm-click').value = prefs.click; $<HTMLInputElement>('#rhythm-swing').value = String(Math.round(prefs.swing * 100));
    text('#rhythm-swing-value', `${Math.round(prefs.swing * 100)}%${prefs.swing === .5 ? '（ストレート）' : Math.abs(prefs.swing - 2 / 3) < .01 ? '（3連）' : ''}`);
    const pattern = current(); $('#rhythm-swing-row').hidden = !pattern || !swings(pattern);
    $<HTMLInputElement>('#rhythm-volume').value = String(prefs.volume);
    const value = offset();
    const label = prefs.method === 'tap' ? 'タップ' : '演奏（音声入力）';
    text('#rhythm-calibration', value === null ? `${label}の補正：未補正` : `${label}の補正：${value} ms（この値を差し引いて判定します）`);
    document.querySelectorAll<HTMLInputElement>('input[name=rhythm-method]').forEach(el => el.checked = el.value === prefs.method);
    $<HTMLButtonElement>('#rhythm-calibration-clear').disabled = value === null;
  }
  const change = (patch: Partial<RhythmPreferences>) => { prefs = { ...prefs, ...patch }; save(); if (mode === 'done') { mode = 'idle'; hits = null; } render(); };
  $('#rhythm-pattern').addEventListener('change', e => change({ patternId: (e.target as HTMLSelectElement).value }));
  $('#rhythm-transform').addEventListener('change', e => change({ transform: (e.target as HTMLSelectElement).value as Transform }));
  $('#rhythm-bpm').addEventListener('change', e => { const v = Math.round(Number((e.target as HTMLInputElement).value)); change({ bpm: Number.isFinite(v) ? Math.min(200, Math.max(40, v)) : prefs.bpm }); });
  $('#rhythm-bars').addEventListener('change', e => change({ bars: Number((e.target as HTMLSelectElement).value) }));
  $('#rhythm-click').addEventListener('change', e => change({ click: (e.target as HTMLSelectElement).value as ClickMode }));
  $('#rhythm-swing').addEventListener('input', e => change({ swing: Number((e.target as HTMLInputElement).value) / 100 }));
  $('#rhythm-volume').addEventListener('input', e => { prefs = { ...prefs, volume: Number((e.target as HTMLInputElement).value) }; sound.setVolume(prefs.volume); save(); });
  $('#rhythm-calibration-clear').addEventListener('click', () => { setOffset(null); render(); });
  document.querySelectorAll<HTMLInputElement>('input[name=rhythm-method]').forEach(el => el.addEventListener('change', () => { stop(); change({ method: el.value as Method }); attachAudio(); }));
  $('#rhythm-primary').addEventListener('click', start);
  $('#rhythm-calibrate').addEventListener('click', startCalibration);
  $('#rhythm-stop').addEventListener('click', stop);
  $('#rhythm-pad').addEventListener('pointerdown', event => { event.preventDefault(); tap(event.timeStamp); });
  document.addEventListener('keydown', event => {
    if (!visible || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.matches('input,select,textarea,[contenteditable=true]')) return;
    if (mode === 'running' || mode === 'calibrating') { if (tapKeys.includes(event.code)) { event.preventDefault(); tap(event.timeStamp); } return; }
    if (target.closest('.harmony-settings,.feature-tabs,.instrument-bar,.harmony-kinds')) return;
    if (event.code === 'Space') { event.preventDefault(); start(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  $('#rhythm-focus-end').addEventListener('click', () => { if (mode !== 'idle') stop(); endFocus(); render(); });
  return {
    /** A rhythm item names the pattern, tapped or played, and a 20 BPM band: practise it in the middle of the band. */
    focus(itemIds: string[], label: string) {
      const [prefix, patternId, band] = itemIds[0]?.split(':') ?? [];
      if (!patterns.some(p => p.id === patternId) || !/^\d+-\d+$/.test(band ?? '')) return;
      if (mode !== 'idle') stop();
      endFocus();
      focus = { label, restore: { patternId: prefs.patternId, bpm: prefs.bpm, method: prefs.method, transform: prefs.transform } };
      prefs = { ...prefs, patternId, bpm: Math.min(200, Math.max(40, parseInt(band, 10) + 10)), method: prefix === 'rhyplay' ? 'play' : 'tap', transform: 'none' };
      render();
    },
    show(show: boolean) { if (!show) endFocus(); if (visible && !show) stop(); const was = visible; visible = show; if (was && !show && hub.activeConsumer === consumer) { tuner.setAudioOwner(null); hub.setActiveConsumer(null); void controller.stop(); } if (show) attachAudio(); render(); },
  };
}
