import { isSource } from '../shared/sources.mjs';
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export const raceKey = m => `${m.session}/${m.race}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const percentile = (sorted, p) => sorted[Math.ceil((sorted.length - 1) * p)];

// Buffer authoritative poses only. No physics, order, or lap prediction lives here.
export class PoseBuffer {
  constructor(delay = 450) { this.delay = delay; this.reset(); }
  reset(key = '') {
    this.key = key; this.frames = []; this.lastArrival = -Infinity;
    this.playhead = null; this.lastSampleAt = null; this.playing = false;
    this.rate = 1; this.gaps = []; this.targetDelay = this.delay;
  }
  push(frame, arrival) {
    if (raceKey(frame) !== this.key) return false;
    const last = this.frames.at(-1);
    if (last && (frame.seq <= last.seq || frame.t < last.t)) return false;
    const gap = arrival - this.lastArrival;
    // A new live segment after an outage should not replay seconds of old state.
    if (last && gap > 2500) this.reset(this.key);
    else if (last && gap > 0) {
      this.gaps.push(gap); this.gaps = this.gaps.slice(-32);
      if (this.gaps.length >= 8) {
        const sorted = [...this.gaps].sort((a, b) => a - b);
        this.targetDelay = clamp(percentile(sorted, .95) + percentile(sorted, .5), this.delay, Math.max(this.delay, 900));
      }
    }
    this.frames.push(frame); this.frames = this.frames.slice(-64); this.lastArrival = arrival;
    return true;
  }
  sample(now) {
    if (!this.frames.length) return null;
    const latest = this.frames.at(-1);
    const oldest = this.frames[0], delay = this.targetDelay / 1000;
    const elapsed = this.lastSampleAt === null ? 0 : Math.max(0, now - this.lastSampleAt) / 1000;
    if (this.stale(now)) {
      this.playhead = latest.t;
      this.playing = false;
    } else if (this.playhead === null || elapsed > 2.5) {
      // Initial buffering, or resuming a suspended browser tab.
      this.playhead = Math.max(this.playhead ?? oldest.t, oldest.t, latest.t - delay);
      this.playing = latest.t - oldest.t >= delay;
      this.rate = 1;
    } else {
      this.playhead = Math.max(oldest.t, this.playhead);
      if (!this.playing && latest.t - this.playhead >= delay) this.playing = true;
      if (this.playing) {
        // Packet arrivals may change the desired RATE, never the playback position.
        // This removes backwards jumps caused by resetting the clock per packet.
        const estimatedSourceNow = latest.t + Math.max(0, now - this.lastArrival) / 1000;
        const desiredRate = clamp(1 + (estimatedSourceNow - this.playhead - delay) * .3, .94, 1.06);
        this.rate += (desiredRate - this.rate) * (1 - Math.exp(-elapsed / .4));
        this.playhead = Math.min(latest.t, this.playhead + elapsed * this.rate);
        // Never extrapolate beyond received positions. Refill after an underrun.
        if (this.playhead >= latest.t) this.playing = false;
      }
    }
    this.lastSampleAt = now;
    const target = this.playhead;
    if (target >= latest.t) return latest;
    let a = this.frames[0], b = a;
    for (const f of this.frames) { if (f.t <= target) a = f; if (f.t >= target) { b = f; break; } b = f; }
    const u = b.t > a.t ? Math.max(0, Math.min(1, (target - a.t) / (b.t - a.t))) : 0;
    const before = new Map(a.cars.map(c => [c[0], c]));
    const state = u < 1 ? a : b;
    return { ...state, t: target, cars: state.cars.map(c => {
      const end = b.cars.find(p => p[0] === c[0]); const start = before.get(c[0]);
      if (!start || !end) return c;
      const p = [...c];
      p[1] = start[1] + (end[1] - start[1]) * u;
      p[2] = start[2] + (end[2] - start[2]) * u;
      p[3] = start[3] + wrapAngle(end[3] - start[3]) * u;
      return p;
    }) };
  }
  stale(now) { return now - this.lastArrival > 2500; }
}

export function relaySocketUrl(address, securePage = false, source = 'esp32') {
  if (!isSource(source)) throw new Error('Unknown race source.');
  const url = new URL(address);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter an HTTP or WebSocket relay address without credentials.');
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:';
  if (securePage && url.protocol !== 'wss:') throw new Error('This page needs a secure relay address starting with https://.');
  url.pathname = '/watch'; url.search = ''; url.hash = '';
  if (source !== 'esp32') url.searchParams.set('source', source);
  return url.href;
}

export class LiveFeed {
  constructor(address, handlers, source = 'esp32') { this.url = relaySocketUrl(address, location.protocol === 'https:', source); this.handlers = handlers; this.closed = false; this.retry = 1000; this.receivedFrame = false; this.open(); }
  open() {
    if (this.closed) return;
    this.handlers.status('connecting');
    const ws = this.socket = new WebSocket(this.url);
    ws.onopen = () => { if (this.closed || this.socket !== ws) return; this.receivedFrame = false; this.retry = 1000; this.handlers.status('waiting'); };
    ws.onmessage = event => {
      if (this.closed || this.socket !== ws) return;
      try { const data = JSON.parse(event.data); if (data.type === 'manifest' || data.type === 'frame') { this.handlers.message(data); if (data.type === 'frame') this.receivedFrame = true; } else if (data.type === 'status' && (!data.connected || !this.receivedFrame)) this.handlers.status(data.connected ? 'waiting' : 'offline'); }
      catch { this.handlers.status('invalid'); }
    };
    ws.onclose = () => { if (this.closed) return; this.handlers.status('reconnecting'); this.timer = setTimeout(() => this.open(), this.retry); this.retry = Math.min(15000, this.retry * 1.7); };
    ws.onerror = () => ws.close();
  }
  close() { this.closed = true; clearTimeout(this.timer); this.socket?.close(); }
}
