const TAU = Math.PI * 2;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Cosmetic motion follows the displayed poses, not packet arrival or wall time.
// A frozen playback buffer therefore freezes the wheels as well.
export class CarMotion {
  constructor(radius, wheelbase, length) {
    this.radius = radius; this.wheelbase = wheelbase; this.length = length;
    this.spin = 0; this.steer = 0; this.previous = null;
  }
  reset() { this.previous = null; this.steer = 0; }
  update(pose, time) {
    const previous = this.previous;
    this.previous = { x: pose[1], z: pose[2], heading: pose[3], speed: pose[4], time };
    if (!previous) return;
    const dt = time - previous.time;
    const dx = pose[1] - previous.x, dz = pose[2] - previous.z;
    const distance = Math.hypot(dx, dz);
    // Rebase on reconnects, tab resumes, race resets and implausible pose jumps.
    const limit = Math.max(this.length * 2, Math.max(Math.abs(pose[4]), Math.abs(previous.speed)) * dt * 3 + this.length * .5);
    if (dt < 0 || dt > .5 || distance > limit) { this.steer = 0; return; }
    if (dt === 0 || distance < 1e-6) return;
    const turn = wrap(pose[3] - previous.heading);
    const heading = previous.heading + turn * .5;
    const forward = dx * Math.cos(heading) + dz * Math.sin(heading);
    // Ignore sideways sliding for tire rolling; reverse motion reverses rotation.
    this.spin = (this.spin - forward / this.radius) % TAU;
    const target = Math.abs(forward) > 1e-4
      ? Math.max(-.48, Math.min(.48, -Math.atan(this.wheelbase * turn / forward))) : 0;
    this.steer += (target - this.steer) * (1 - Math.exp(-dt / .10));
  }
}
