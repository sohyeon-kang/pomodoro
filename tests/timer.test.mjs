import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A data URL keeps this test independent of a package.json module setting.
const source = await readFile(new URL('../dist/timer.js', import.meta.url), 'utf8');
const { TimerEngine } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function setup(state = null) {
  let time = 1_000_000;
  const events = [];
  const timer = new TimerEngine({ now: () => time, state, onComplete: event => events.push(event) });
  return { timer, events, advance: ms => { time += ms; }, setTime: ms => { time = ms; } };
}

test('defaults to a configurable 25-minute study session and validates bounds', () => {
  const { timer } = setup();
  assert.equal(timer.mode, 'focus');
  assert.equal(timer.status, 'idle');
  assert.equal(timer.remainingMs, 25 * 60_000);
  timer.setDuration('focus', 180);
  assert.equal(timer.totalMs, 180 * 60_000);
  timer.setDuration('short', 60);
  assert.equal(timer.durations.short, 60);
  for (const value of [0, -1, 181, 1.5, NaN, Infinity, '25']) {
    assert.throws(() => timer.setDuration('focus', value), RangeError);
  }
  assert.throws(() => timer.setDuration('long', 61), RangeError);
  assert.throws(() => timer.switchMode('unknown'), RangeError);
});

test('pause/resume excludes paused time and cannot drift when ticks are late', () => {
  const { timer, advance, events } = setup();
  timer.setDuration('focus', 1).start();
  advance(12_345);
  timer.pause();
  assert.equal(timer.remainingMs, 47_655);
  assert.equal(timer.elapsedFocusMs, 12_345);
  advance(100_000);
  assert.equal(timer.remainingMs, 47_655);
  assert.equal(timer.elapsedFocusMs, 12_345);
  timer.start();
  advance(80_000);
  const event = timer.tick();
  assert.equal(timer.status, 'completed');
  assert.equal(timer.remainingMs, 0);
  assert.equal(timer.elapsedFocusMs, 60_000);
  assert.equal(event.durationMs, 60_000);
  assert.equal(event.completedAt, 1_160_000);
  assert.equal(events.length, 1);
  assert.equal(timer.tick(), null);
  assert.equal(timer.completedFocusSessions, 1);
});

test('breaks do not add focus time; reset and mode changes retain accumulated work', () => {
  const { timer, advance } = setup();
  timer.start();
  advance(8_000);
  timer.reset();
  assert.equal(timer.elapsedFocusMs, 8_000);
  assert.equal(timer.remainingMs, 25 * 60_000);
  timer.start();
  advance(2_000);
  timer.switchMode('short').start();
  advance(5 * 60_000);
  timer.tick();
  assert.equal(timer.elapsedFocusMs, 10_000);
  assert.equal(timer.completedFocusSessions, 0);
  assert.equal(timer.nextMode, 'focus');
});

test('every fourth completed focus recommends a long break', () => {
  const { timer, advance } = setup();
  timer.setDuration('focus', 1);
  for (let count = 1; count <= 8; count += 1) {
    timer.start();
    advance(60_000);
    const event = timer.tick();
    assert.equal(timer.completedFocusSessions, count);
    assert.equal(event.nextMode, count % 4 === 0 ? 'long' : 'short');
  }
  assert.equal(timer.elapsedFocusMs, 8 * 60_000);
});

test('restoring a running timer uses the original deadline and completes once', () => {
  const first = setup();
  first.timer.setDuration('focus', 1).start();
  first.advance(10_000);
  const state = JSON.parse(JSON.stringify(first.timer.getState()));
  const second = setup(state);
  second.setTime(1_040_000);
  assert.equal(second.timer.remainingMs, 20_000);
  assert.equal(second.timer.elapsedFocusMs, 40_000);
  second.advance(90_000);
  const completion = second.timer.tick();
  assert.equal(completion.completedAt, 1_060_000);
  assert.equal(second.timer.elapsedFocusMs, 60_000);
  assert.equal(second.timer.completedFocusSessions, 1);
  assert.equal(second.timer.tick(), null);
  assert.equal(second.events.length, 1);
});

test('unemitted completion survives serialization without counting or notifying twice', () => {
  const first = setup();
  first.timer.setDuration('focus', 1).start();
  first.advance(60_000);
  // Reading state detects completion; only tick delivers the event.
  const second = setup(JSON.parse(JSON.stringify(first.timer.getState())));
  assert.equal(second.events.length, 0);
  assert.equal(second.timer.completedFocusSessions, 1);
  assert.ok(second.timer.tick());
  assert.equal(second.timer.tick(), null);
  const third = setup(JSON.parse(JSON.stringify(second.timer.getState())));
  assert.equal(third.timer.tick(), null);
  assert.equal(third.timer.completedFocusSessions, 1);
  assert.equal(third.events.length, 0);
});

test('restored paused timer remains paused; changing current duration resets the session', () => {
  const first = setup();
  first.timer.start();
  first.advance(5_000);
  first.timer.pause();
  const second = setup(first.timer.getState());
  second.advance(1_000_000);
  assert.equal(second.timer.status, 'paused');
  assert.equal(second.timer.remainingMs, 25 * 60_000 - 5_000);
  assert.equal(second.timer.elapsedFocusMs, 5_000);
  second.timer.setDuration('focus', 40);
  assert.equal(second.timer.status, 'idle');
  assert.equal(second.timer.remainingMs, 40 * 60_000);
  assert.equal(second.timer.elapsedFocusMs, 5_000);
});

test('repeated start does not move the deadline and a backwards clock does not add time', () => {
  const { timer, advance, setTime } = setup();
  timer.setDuration('focus', 1).start();
  advance(10_000);
  timer.start();
  assert.equal(timer.remainingMs, 50_000);
  setTime(1_005_000);
  assert.equal(timer.remainingMs, 50_000);
  assert.equal(timer.elapsedFocusMs, 10_000);
  setTime(1_060_000);
  assert.ok(timer.tick());
  assert.equal(timer.elapsedFocusMs, 60_000);
});

test('corrupt persisted settings fall back safely and malformed deadlines do not run', () => {
  const { timer } = setup({
    version: 1, durations: { focus: -10, short: 'x', long: 20 }, mode: 'focus',
    status: 'running', remainingMs: 20_000, deadline: null, lastActiveAt: null,
  });
  assert.deepEqual(timer.durations, { focus: 25, short: 5, long: 20 });
  assert.equal(timer.status, 'paused');
  assert.equal(timer.remainingMs, 20_000);
});
