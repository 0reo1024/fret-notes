import { $, $$ } from '../../ui/dom';
import { localDate, summarize, type DailySummary } from '../../domain/training/records';
import { advancedStatus, unlockShare } from '../../domain/training/advanced';
import {
  allLevels, destinationOf, inputHealth, levelContext, reachedDates, reachedKey, roleNames, streakDays, targetChoices, targetMethods, targetsOf, todayMenu, weakness, weaknessTables,
  type Focus, type LevelContext, type MenuStep, type WeaknessCell, type WeaknessTable,
} from '../../domain/training/analysis';
import { intervalNames } from '../../domain/training/interval-questions';
import { kindNames } from '../../domain/training/ear';
import { patterns } from '../../domain/training/rhythm';
import { chords } from '../../domain/music/theory';
import type { SkillLayer } from '../../domain/training/records';
import type { create } from '../../domain/instruments/core';
import type { TrainingRepository } from '../../platform/training-store';

const maximumImportBytes = 8 * 1024 * 1024;
const duration = (seconds: number) => seconds < 60 ? `${Math.round(seconds)}秒` : `${Math.floor(seconds/60)}分${String(Math.round(seconds%60)).padStart(2,'0')}秒`;
const rate = (d: DailySummary) => d.attempts ? `正答率 ${Math.round(d.correct/d.attempts*100)}%` : '記録なし';
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** Layers each table can hold: ear and rhythm are only played, board intervals are only clicked or played. */
const tableLayers: Record<WeaknessTable, SkillLayer[]> = { ct: ['knowledge', 'fretboard', 'performance'], iv: ['knowledge', 'fretboard', 'performance'], ivf: ['fretboard', 'performance'], fb: ['knowledge', 'fretboard'], ear: ['performance'], rhy: ['performance'] };
const layerNames: Record<SkillLayer, string> = { knowledge: '知識', fretboard: '指板', performance: '演奏' };
const qualityName = (id: string) => chords.find(q => q.id === id)?.label ?? id;
/** Readable row and column labels per table. */
function label(table: WeaknessTable, axis: 'row' | 'column', value: string) {
  if (table === 'ct') return axis === 'row' ? qualityName(value) : roleNames[value] ?? value;
  if (table === 'iv' || table === 'ivf') return axis === 'row' ? intervalNames[value as keyof typeof intervalNames] ?? value : value === 'up' ? '上行' : '下行';
  if (table === 'fb') return axis === 'row' ? `${value}弦` : value;
  if (table === 'ear') return axis === 'row' ? `${value}音` : `${kindNames[value.split(':')[0] as keyof typeof kindNames] ?? value}${value.endsWith(':chromatic') ? '（半音階）' : ''}`;
  if (axis === 'row') { const [id, play] = value.split(':'); return `${patterns.find(p => p.id === id)?.name ?? id}${play ? '（演奏）' : ''}`; }
  return `${value.replace('-', '〜')} BPM`;
}
/** Symbol and tone so the grid never relies on colour alone. */
function grade(cell: WeaknessCell) {
  if (cell.insufficient || cell.accuracy === null) return { symbol: '…', tone: 'none' };
  const a = cell.accuracy;
  return a >= .9 ? { symbol: '◎', tone: 'good' } : a >= .75 ? { symbol: '○', tone: 'fair' } : a >= .5 ? { symbol: '△', tone: 'weak' } : { symbol: '×', tone: 'poor' };
}

export interface RecordsHost {
  /** Current instrument core (strings and tuning) for the fretboard levels and tables. */
  core(): ReturnType<typeof create>;
  /** Opens a trainer, practising only the focus items when given. */
  navigate(focus: Focus): void;
  openRecords(): void;
  openTuner(): void;
}

/** Records tab: today's practice first, then overview, levels, weak spots, input health and the daily table. Replacing records always asks first, inline. */
export function mountRecords(training: TrainingRepository, host: RecordsHost, now = () => new Date()) {
  let visible = false, pending: (() => Promise<void>) | null = null;
  let selected: { table: WeaknessTable; row: string; column: string } | null = null;
  /** Today's practice in progress: the steps fixed when it started, the current one and when it began. */
  let run: { steps: MenuStep[]; index: number; startedAt: number } | null = null, tick: ReturnType<typeof setInterval> | null = null;
  const status = (message: string) => { $('#records-status').textContent = message; };
  const context = (): LevelContext => { const core = host.core(); return levelContext(core, core.id); };
  const view = () => {
    const value = training.current.preferences.recordsView as { table?: string; layer?: string } | undefined;
    const table = weaknessTables.some(t => t.id === value?.table) ? value!.table as WeaknessTable : 'ct';
    const layer = tableLayers[table].includes(value?.layer as SkillLayer) ? value!.layer as SkillLayer : tableLayers[table][0];
    return { table, layer };
  };
  function confirm(message: string, action: string, run: () => Promise<void>) {
    pending = run; $('#records-confirm-text').textContent = message; $('#records-confirm-yes').textContent = action;
    $('#records-confirm').hidden = false; $('#records-confirm-yes').focus();
  }
  function cancel() { pending = null; $('#records-confirm').hidden = true; }
  $('#records-confirm-no').addEventListener('click', () => { cancel(); status(''); });
  $('#records-confirm-yes').addEventListener('click', async () => {
    const run = pending; cancel(); if (!run) return;
    try { await run(); } catch (error) { status(`操作できません：${error instanceof Error ? error.message : String(error)}`); }
  });
  $('#records-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([training.exportJson()], { type: 'application/json' })), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'fret-notes-training.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('学習記録を書き出しました');
  });
  $('#records-import').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    try {
      if (file.size > maximumImportBytes) throw new Error('学習記録のファイルが大きすぎます');
      const data = JSON.parse(await file.text());
      confirm(`「${file.name}」で現在の学習記録をすべて置き換えます。`, '置き換える', async () => { await training.replace(data); status('学習記録を読み込みました'); });
    } catch (error) { status(`読み込めません：${error instanceof Error ? error.message : String(error)}`); }
  });
  $('#records-show-advanced').addEventListener('change', e => { training.updatePreferences('showAdvanced', (e.target as HTMLInputElement).checked); render(); });
  $('#records-dorian-13').addEventListener('change', e => { training.updatePreferences('dorianThirteenth', (e.target as HTMLInputElement).checked); render(); });
  $('#records-clear').addEventListener('click', () => confirm('学習記録をすべて消去します。元に戻せません。必要なら先に書き出してください。', '消去する', async () => { await training.clear(); status('学習記録を消去しました'); }));

  // Response-time goals
  $$<HTMLSelectElement>('[data-target]').forEach(select => {
    select.replaceChildren(...targetChoices.map(ms => { const option = document.createElement('option'); option.value = String(ms); option.textContent = `${(ms / 1000).toFixed(1)}秒`; return option; }));
    select.addEventListener('change', () => training.updatePreferences('targets', { ...targetsOf(training.current.preferences), [select.dataset.target!]: Number(select.value) }));
  });

  // Weak spots
  $('#weak-table').replaceChildren(...weaknessTables.map(t => { const option = document.createElement('option'); option.value = t.id; option.textContent = `${t.name}（${t.rows} × ${t.columns}）`; return option; }));
  const saveView = (patch: { table?: string; layer?: string }) => { selected = null; training.updatePreferences('recordsView', { ...view(), ...patch }); };
  $('#weak-table').addEventListener('change', e => saveView({ table: (e.target as HTMLSelectElement).value, layer: undefined }));
  $('#weak-layer').addEventListener('change', e => saveView({ layer: (e.target as HTMLSelectElement).value }));
  $('#weak-grid').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-row]');
    if (!button) return;
    selected = { table: view().table, row: button.dataset.row!, column: button.dataset.column! }; render();
  });
  function selectedCell() {
    if (!selected || selected.table !== view().table) return null;
    const { table, layer } = view(), grid = weakness(training.current.stats, { table, layer, instrument: host.core().id }, targetsOf(training.current.preferences));
    return grid.cells.find(c => c.row === selected!.row && c.column === selected!.column) ?? null;
  }
  $('#weak-practice').addEventListener('click', () => {
    const cell = selectedCell(), { table, layer } = view();
    const destination = cell && destinationOf(cell.itemIds[0]);
    if (!cell || !destination) return;
    host.navigate({ feature: destination.feature, kind: destination.kind, layer, itemIds: cell.itemIds, label: `${label(table, 'row', cell.row)} × ${label(table, 'column', cell.column)}（${layerNames[layer]}）` });
  });
  $('#input-tuner').addEventListener('click', () => host.openTuner());

  // Today's practice
  function stopRun(finished: boolean) {
    run = null; if (tick) clearInterval(tick); tick = null; $('#today-bar').hidden = true; document.body.classList.remove('today-running');
    if (finished) training.updatePreferences('todayDone', localDate(now()));
  }
  function goToStep() {
    if (!run) return;
    const step = run.steps[run.index]; run.startedAt = performance.now();
    renderBar(); host.navigate(step.focus);
  }
  function renderBar() {
    if (!run) return;
    const step = run.steps[run.index], elapsed = performance.now() - run.startedAt, over = elapsed >= step.minutes * 60000;
    $('#today-bar').hidden = false; document.body.classList.add('today-running');
    $('#today-bar-step').textContent = `今日の練習 ${run.index + 1} / ${run.steps.length}：${step.title}（${step.focus.label}）`;
    $('#today-bar-time').textContent = over ? `${step.minutes}分たちました。区切りのよいところで次へ` : `${clock(elapsed)} / ${step.minutes}分`;
    $('#today-bar').classList.toggle('is-over', over);
    $('#today-bar-next').textContent = run.index + 1 < run.steps.length ? '次へ →' : '終えて記録へ';
  }
  $('#today-start').addEventListener('click', () => {
    const steps = todayMenu(training.current, now(), context());
    if (!steps.length) return;
    run = { steps, index: 0, startedAt: performance.now() };
    tick ??= setInterval(renderBar, 1000);
    goToStep();
  });
  $('#today-bar-next').addEventListener('click', () => {
    if (!run) return;
    if (run.index + 1 < run.steps.length) { run.index++; goToStep(); return; }
    stopRun(true); host.openRecords(); status('今日の練習を終えました。おつかれさまでした');
  });
  $('#today-bar-stop').addEventListener('click', () => stopRun(false));

  function renderToday(steps: MenuStep[]) {
    const done = training.current.preferences.todayDone === localDate(now());
    $('#today-steps').replaceChildren(...steps.map(step => {
      const item = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = `${step.title}　${step.minutes}分`; detail.textContent = `${step.focus.label} ／ ${step.detail}`;
      item.append(title, detail); return item;
    }));
    $('#today-total').textContent = steps.length ? `約${steps.reduce((n, s) => n + s.minutes, 0)}分` : '';
    $('#today-note').textContent = done ? '今日の練習は完了しています。続けて練習する場合は、もう一度始めてください。' : steps.length ? '始めると、各トレーナーへ順に移ります。画面下のバーで次へ進みます。' : '';
    $<HTMLButtonElement>('#today-start').disabled = !steps.length || !!run;
    $('#today-start').textContent = run ? '練習中' : done ? 'もう一度始める' : '今日の練習を始める';
  }
  function renderLevels() {
    const ctx = context(), progress = allLevels(training.current, ctx);
    const previous = (training.current.preferences.levelsReached ?? {}) as Record<string, string>;
    const next = reachedDates(previous, progress, ctx, now());
    // Written only when a level is newly reached, so the change notification does not loop.
    if (next) training.updatePreferences('levelsReached', next);
    const reached = next ?? previous;
    $('#records-levels').replaceChildren(...progress.map(level => {
      const row = document.createElement('div'), name = document.createElement('span'), bar = document.createElement('progress'), figure = document.createElement('span'), date = document.createElement('span');
      row.className = `level-row${level.reached ? ' is-reached' : ''}`;
      name.textContent = `${level.id} ${level.name}`; name.title = level.description;
      bar.max = level.total; bar.value = level.mastered; bar.setAttribute('aria-label', `${level.id} ${level.name}：${level.mastered} / ${level.total}`);
      figure.textContent = `${level.mastered} / ${level.total}（${Math.round(level.ratio * 100)}%）`;
      const when = reached[reachedKey(level.id, ctx)];
      date.textContent = level.reached ? `到達 ${when ?? ''}` : when ? `${when} に到達` : '';
      row.append(name, bar, figure, date); return row;
    }));
  }
  function renderWeakness() {
    const { table, layer } = view(), info = weaknessTables.find(t => t.id === table)!;
    $<HTMLSelectElement>('#weak-table').value = table;
    $$<HTMLOptionElement>('#weak-layer option').forEach(option => { option.hidden = option.disabled = !tableLayers[table].includes(option.value as SkillLayer); });
    $<HTMLSelectElement>('#weak-layer').value = layer;
    const grid = weakness(training.current.stats, { table, layer, instrument: host.core().id }, targetsOf(training.current.preferences));
    $('#weak-empty').hidden = grid.cells.length > 0;
    $('#weak-empty').textContent = `この表（${info.name}・${layerNames[layer]}）の記録はまだありません。`;
    const head = document.createElement('tr'), corner = document.createElement('th');
    corner.textContent = `${info.rows} ＼ ${info.columns}`; head.append(corner);
    for (const column of grid.columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label(table, 'column', column); head.append(th); }
    const rows = grid.rows.map(row => {
      const tr = document.createElement('tr'), th = document.createElement('th'); th.scope = 'row'; th.textContent = label(table, 'row', row); tr.append(th);
      for (const column of grid.columns) {
        const td = document.createElement('td'), cell = grid.cells.find(c => c.row === row && c.column === column);
        if (cell) {
          const { symbol, tone } = grade(cell), button = document.createElement('button');
          const percent = cell.accuracy === null ? '—' : `${Math.round(cell.accuracy * 100)}%`, time = cell.medianMs === null ? '' : `${(cell.medianMs / 1000).toFixed(1)}秒`;
          button.type = 'button'; button.className = `weak-cell tone-${tone}`; button.dataset.row = row; button.dataset.column = column;
          button.setAttribute('aria-pressed', String(selected?.row === row && selected?.column === column));
          button.innerHTML = `<span><span class="weak-mark">${symbol}</span> ${percent}</span><small>${time}</small>`;
          button.title = `${label(table, 'row', row)} × ${label(table, 'column', column)}：${cell.attempts}回${cell.insufficient ? '（データ不足）' : ''} · 正答率 ${percent}${time ? ` · 反応 中央値 ${time}` : ''} · 定着 ${Math.round(cell.masteredShare * 100)}% · ${cell.itemIds.length}項目`;
          td.append(button);
        }
        tr.append(td);
      }
      return tr;
    });
    $('#weak-grid').replaceChildren(...(grid.cells.length ? [head, ...rows] : []));
    if (grid.hiddenRows) { const note = document.createElement('caption'); note.textContent = `弱い順に12行を表示（ほか ${grid.hiddenRows}行）`; $('#weak-grid').prepend(note); }
    const cell = selectedCell();
    $<HTMLButtonElement>('#weak-practice').disabled = !cell || !destinationOf(cell.itemIds[0]);
    $('#weak-selection').textContent = cell
      ? `${label(table, 'row', cell.row)} × ${label(table, 'column', cell.column)}：${cell.attempts}回 · 正答率 ${cell.accuracy === null ? '—' : `${Math.round(cell.accuracy * 100)}%`} · 定着 ${Math.round(cell.masteredShare * 100)}% · ${cell.itemIds.length}項目`
      : 'セルを選ぶと、その項目だけを練習できます';
  }
  function renderInput() {
    const health = inputHealth(training.current.attempts);
    $('#input-health').textContent = !health.played ? '演奏・歌での回答はまだありません。'
      : `直近の演奏・歌の回答 ${health.played}回のうち、入力の問題（検出の失敗・音割れなど）${health.issues}回（${Math.round(health.ratio * 100)}%）。${health.warn ? '多めです。入力レベルと無音のしきい値を見直してください（入力の問題は判定と復習から除外しています）。' : '問題ありません。'}`;
    $('#input-tuner').hidden = !health.warn;
  }
  function render() {
    if (!visible) return;
    const at = now(), summary = summarize(training.current, at), steps = todayMenu(training.current, at, context());
    renderToday(steps);
    $('#records-today').textContent = `${summary.today.attempts}問`;
    $('#records-today-detail').textContent = `${rate(summary.today)} · 回答時間 ${duration(summary.today.seconds)}`;
    $('#records-week').textContent = `${summary.week.attempts}問`;
    $('#records-week-detail').textContent = `${rate(summary.week)} · 回答時間 ${duration(summary.week.seconds)}`;
    const streak = streakDays(training.current.daily, at);
    $('#records-streak').textContent = `${streak}日`;
    $('#records-streak-detail').textContent = summary.today.attempts ? '今日も練習しました' : streak ? '今日練習すると続きます' : '今日から始めましょう';
    $('#records-items').textContent = `${summary.items}項目`;
    $('#records-items-detail').textContent = `定着 ${summary.mastered} · 復習 ${summary.due}`;
    const advanced = advancedStatus(training.current), shown = training.current.preferences.showAdvanced === true;
    $('#records-advanced').textContent = advanced.unlocked ? '開放済み' : shown ? '表示中' : '未開放';
    $('#records-advanced-detail').textContent = `ガイドトーン（maj7・m7・7・m7♭5 の 3rd・7th）定着 ${advanced.mastered} / ${advanced.total}（${Math.round(advanced.ratio * 100)}%。${Math.round(unlockShare * 100)}%で開放）${!advanced.unlocked && shown ? ' · 「すべて表示」で開いています' : ''}`;
    $<HTMLInputElement>('#records-show-advanced').checked = shown; $<HTMLInputElement>('#records-dorian-13').checked = training.current.preferences.dorianThirteenth === true;
    const targets = targetsOf(training.current.preferences);
    for (const method of targetMethods) $<HTMLSelectElement>(`#target-${method}`).value = String(targets[method]);
    renderLevels(); renderWeakness(); renderInput();
    const rows = summary.days.slice().reverse().map((d, index) => {
      const row = document.createElement('tr'); if (index === 0) row.className = 'is-today';
      for (const value of [index === 0 ? `${d.date}（今日）` : d.date, String(d.attempts), String(d.correct), duration(d.seconds)]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      return row;
    });
    $('#records-days').replaceChildren(...rows);
  }
  return {
    render,
    show(show: boolean) { visible = show; if (!show) cancel(); render(); },
  };
}
