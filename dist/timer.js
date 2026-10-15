/** A deadline-based Pomodoro timer. No DOM, interval, or storage dependencies. */
const MODES = Object.freeze(['focus', 'short', 'long']);
const DEFAULT_DURATIONS = Object.freeze({ focus: 25, short: 5, long: 15 });
const MINUTE = 60_000;

function assertMode(mode) {
  if (!MODES.includes(mode)) throw new RangeError(`Unknown timer mode: ${mode}`);
}

function assertDuration(mode, minutes) {
  assertMode(mode);
  const maximum = mode === 'focus' ? 180 : 60;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > maximum) {
    throw new RangeError(`${mode} duration must be an integer from 1 to ${maximum} minutes.`);
  }
}

const nonnegative = (value, fallback = 0) =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

export class TimerEngine {
  constructor({ now = Date.now, state = null, onComplete = null } = {}) {
    if (typeof now !== 'function') throw new TypeError('now must be a function.');
    if (onComplete !== null && typeof onComplete !== 'function') {
      throw new TypeError('onComplete must be a function.');
    }
    this._now = now;
    this.onComplete = onComplete;
    this._durations = { ...DEFAULT_DURATIONS };
    this._mode = 'focus';
    this._status = 'idle';
    this._remainingMs = DEFAULT_DURATIONS.focus * MINUTE;
    this._deadline = null;
    this._lastActiveAt = null;
    this._sessionElapsedMs = 0;
    this._elapsedFocusMs = 0;
    this._completedFocusSessions = 0;
    this._sessionSerial = 0;
    this._sessionId = null;
    this._startedAt = null;
    this._completion = null;
    this._completionEmitted = false;
    if (state && typeof state === 'object') this._restore(state);
  }

  get mode() { return this._mode; }
  get status() { this._sync(); return this._status; }
  get durations() { return { ...this._durations }; }
  get totalMs() { return this._durations[this._mode] * MINUTE; }
  get remainingMs() { this._sync(); return this._remainingMs; }
  get elapsedFocusMs() { this._sync(); return this._elapsedFocusMs; }
  get completedFocusSessions() { this._sync(); return this._completedFocusSessions; }
  get sessionElapsedMs() { this._sync(); return this._sessionElapsedMs; }
  get nextMode() {
    if (this._mode !== 'focus') return 'focus';
    const count = this._completedFocusSessions + (this._status === 'completed' ? 0 : 1);
    return count > 0 && count % 4 === 0 ? 'long' : 'short';
  }

  /** Returns a completion exactly once; also invokes the optional callback. */
  tick() {
    this._sync();
    if (!this._completion || this._completionEmitted) return null;
    this._completionEmitted = true;
    const completion = { ...this._completion };
    this.onComplete?.(completion);
    return completion;
  }

  start() {
    this.tick();
    if (this._status === 'running') return this;
    if (this._status === 'completed') this._resetSession();
    const now = this._now();
    if (this._status === 'idle') {
      this._sessionSerial += 1;
      this._sessionId = `${this._mode}-${now}-${this._sessionSerial}`;
      this._startedAt = now;
    }
    this._status = 'running';
    this._lastActiveAt = now;
    this._deadline = now + this._remainingMs;
    return this;
  }

  pause() {
    this.tick();
    if (this._status === 'running') {
      this._status = 'paused';
      this._deadline = null;
      this._lastActiveAt = null;
    }
    return this;
  }

  reset() {
    this.tick();
    this._resetSession();
    return this;
  }

  switchMode(mode) {
    assertMode(mode);
    this.tick();
    if (mode === this._mode) return this;
    this._mode = mode;
    this._resetSession();
    return this;
  }

  /** Changing the active mode's duration resets its current session. */
  setDuration(mode, minutes) {
    assertDuration(mode, minutes);
    this.tick();
    if (this._durations[mode] === minutes) return this;
    this._durations[mode] = minutes;
    if (mode === this._mode) this._resetSession();
    return this;
  }

  /** JSON-safe state. Reading state synchronizes time but does not emit events. */
  getState() {
    this._sync();
    return {
      version: 1,
      durations: this.durations,
      mode: this._mode,
      status: this._status,
      remainingMs: this._remainingMs,
      deadline: this._deadline,
      lastActiveAt: this._lastActiveAt,
      sessionElapsedMs: this._sessionElapsedMs,
      elapsedFocusMs: this._elapsedFocusMs,
      completedFocusSessions: this._completedFocusSessions,
      sessionSerial: this._sessionSerial,
      sessionId: this._sessionId,
      startedAt: this._startedAt,
      completion: this._completion ? { ...this._completion } : null,
      completionEmitted: this._completionEmitted,
    };
  }

  _resetSession() {
    this._status = 'idle';
    this._remainingMs = this.totalMs;
    this._deadline = null;
    this._lastActiveAt = null;
    this._sessionElapsedMs = 0;
    this._sessionId = null;
    this._startedAt = null;
    this._completion = null;
    this._completionEmitted = false;
  }

  _sync() {
    if (this._status !== 'running') return;
    // Ignore a clock moving backwards until it catches up to the last sample.
    const now = Math.max(this._now(), this._lastActiveAt);
    const activeUntil = Math.min(now, this._deadline);
    const elapsed = Math.max(0, activeUntil - this._lastActiveAt);
    this._sessionElapsedMs += elapsed;
    if (this._mode === 'focus') this._elapsedFocusMs += elapsed;
    this._lastActiveAt = activeUntil;
    this._remainingMs = Math.max(0, this._deadline - now);
    if (now < this._deadline) return;

    const completedAt = this._deadline;
    this._status = 'completed';
    this._deadline = null;
    this._lastActiveAt = null;
    if (this._mode === 'focus') this._completedFocusSessions += 1;
    this._completion = {
      id: this._sessionId,
      mode: this._mode,
      startedAt: this._startedAt,
      completedAt,
      durationMs: this._sessionElapsedMs,
      elapsedFocusMs: this._elapsedFocusMs,
      completedFocusSessions: this._completedFocusSessions,
      nextMode: this.nextMode,
    };
    this._completionEmitted = false;
  }

  _restore(state) {
    if (state.version !== 1) return;
    for (const mode of MODES) {
      try {
        assertDuration(mode, state.durations?.[mode]);
        this._durations[mode] = state.durations[mode];
      } catch { /* Keep defaults for missing or corrupt preferences. */ }
    }
    this._mode = MODES.includes(state.mode) ? state.mode : 'focus';
    this._elapsedFocusMs = nonnegative(state.elapsedFocusMs);
    this._completedFocusSessions = Math.floor(nonnegative(state.completedFocusSessions));
    this._sessionSerial = Math.floor(nonnegative(state.sessionSerial));
    this._resetSession();
    if (!['idle', 'running', 'paused', 'completed'].includes(state.status)) return;
    this._status = state.status;
    this._remainingMs = Math.min(this.totalMs, nonnegative(state.remainingMs, this.totalMs));
    this._sessionElapsedMs = Math.min(this.totalMs, nonnegative(state.sessionElapsedMs));
    this._sessionId = typeof state.sessionId === 'string' ? state.sessionId : null;
    this._startedAt = Number.isFinite(state.startedAt) ? state.startedAt : null;

    if (this._status === 'running') {
      if (!Number.isFinite(state.deadline) || !Number.isFinite(state.lastActiveAt)
        || state.lastActiveAt > state.deadline) {
        this._status = 'paused';
      } else {
        this._deadline = state.deadline;
        this._lastActiveAt = state.lastActiveAt;
      }
    }
    if (this._status === 'completed') {
      this._remainingMs = 0;
      this._completion = state.completion && typeof state.completion === 'object'
        ? { ...state.completion }
        : {
          id: this._sessionId,
          mode: this._mode,
          startedAt: this._startedAt,
          completedAt: this._now(),
          durationMs: this._sessionElapsedMs,
          elapsedFocusMs: this._elapsedFocusMs,
          completedFocusSessions: this._completedFocusSessions,
          nextMode: this.nextMode,
        };
      this._completionEmitted = state.completionEmitted === true;
    }
  }
}

export { DEFAULT_DURATIONS };
export default TimerEngine;
