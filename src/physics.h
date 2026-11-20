#pragma once
// ═══════════════════════════════════════════════════════════════════════════════
//  Contact physics (Pi edition)
//
//  The drivers still race on the ESP32's model: speed, heading and steering
//  curvature, with all of the racecraft on top. What changes is everything that
//  touches a car. Each car is a box with a mass and a moment of inertia. Contacts
//  between two cars are found with the separating-axis test on the two rotated
//  boxes, and against a barrier from the car's corners. The impulse at the
//  contact point changes both the speed and the spin, so a tap on the rear
//  corner turns a car round, and a heavy van shoves a Formula car aside.
//
//  A racing car takes the hit as a sideways slide and a yaw kick that its tyres
//  and its driver try to catch. Too much of either and the car is loose: it
//  slides and rotates under tyre friction (sideways it scrubs speed fast, rolling
//  forward it doesn't) until it stops or the driver gathers it up.
//
//  Damage comes from the change in speed the impulse causes, and where it lands:
//  the nose costs grip, the rear costs traction, and anything costs top speed.
//  Bodywork comes off as debris that lies on the track for a few seconds.
// ═══════════════════════════════════════════════════════════════════════════════

// (physOn and physDbg are declared at the top of cars.h)

// Mass (×) by class: CC_FORMULA, CC_PROTO, CC_GT, CC_TOURING, CC_CLASSIC, CC_VAN, CC_BIKE (with its rider), CC_KART
static const float CLS_MASS[CC_COUNT] = { 1.00f, 1.15f, 1.35f, 1.25f, 1.10f, 1.90f, 0.30f, 0.45f };
// Damage taken (×) and resistance to being spun (inertia ×) by class: a kart is all bumpers and a low, wide stance
static const float CLS_TOUGH[CC_COUNT] = { 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 0.45f };
static const float CLS_SPINK[CC_COUNT] = { 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.0f, 1.8f };

#define PH_E_CAR       0.20f    // restitution, car on car (crumpling bodywork keeps it low)
#define PH_E_WALL      0.30f    // and against a barrier
#define PH_MU_CAR      0.30f    // friction between two cars' bodywork
#define PH_MU_WALL     0.45f    // and scraping along a barrier
#define PH_SLOP        0.15f    // px of overlap left alone (stops jitter between cars side by side)
#define PH_PUSH        0.8f     // share of the overlap removed each step
#define PH_SLIP_LOOSE  38.0f    // px/s of sideways slide a driver can still catch (full grip)
#define PH_YAW_LOOSE   2.6f     // rad/s of yaw kick a driver can still catch at racing speed...
#define PH_YAW_SLOW_V  40.0f    // ...and more the slower they're going (×(1 + this / v))
#define PH_DV_LOOSE    34.0f    // px/s: a hit this hard always loses the car
#define PH_SLIDE_GRIP  0.85f    // share of the tyre's grip that goes into killing a slide
#define PH_YAW_DAMP    5.0f     // 1/s: how fast tyres and the driver stop a small yaw kick
#define PH_DV0         5.0f     // px/s of speed change a car shrugs off without damage
#define PH_DV_FULL     75.0f    // px/s on top of that: about a write-off
#define PH_DMG_POW     1.6f     // small knocks do little, big ones a lot
#define PH_DV_EVENT    9.0f     // a contact worth calling out
#define PH_DV_WALL_EV  18.0f    // a barrier hit worth calling out
#define PH_DMG_GRIP_F  0.08f    // grip lost with the nose destroyed
#define PH_DMG_ACC_R   0.15f    // acceleration lost with the rear destroyed
#define PH_CATCH_YAW   1.0f     // rad/s: a loose car turning slower than this...
#define PH_CATCH_ANG   0.25f    // ...and sliding within this of where it points...
#define PH_CATCH_V     25.0f    // ...at this speed or more, is gathered up and driven on
#define PH_SPIN_CALL   0.7f     // s: a car knocked loose and not caught by then has spun

static inline float carMass(const Car& c) { return CLS_MASS[c.cls]; }
static inline float carInertia(const Car& c) {
  const ClassSpec& s = CLS[c.cls];
  return carMass(c) * (s.len * s.len + s.wid * s.wid) / 12.0f * CLS_SPINK[c.cls];
}

// ─── Velocity of a car as a rigid body, whatever state it's in ───────────────
static void physVel(const Car& c, float& vx, float& vy, float& w) {
  if (c.state == CS_RACE) {
    const float ch = cosf(c.heading), sh = sinf(c.heading);
    vx = ch * c.v + c.slipVx; vy = sh * c.v + c.slipVy; w = c.v * c.kappa + c.yawV;
  } else if (c.state == CS_SPIN) {
    vx = cosf(c.travel) * c.v; vy = sinf(c.travel) * c.v; w = c.spinV;
  } else { vx = vy = 0; w = 0; }
}

static void physLoose(Car& c, int i, float vx, float vy, float w) {
  c.state = CS_SPIN;
  c.v = sqrtf(vx * vx + vy * vy);
  c.travel = c.v > 0.01f ? atan2f(vy, vx) : c.heading;
  c.spinV = w;
  c.slipVx = c.slipVy = c.yawV = 0; c.slip = 0; c.kappa = 0;
  c.passT = 0; c.outMove = 0;
  c.looseT = 0.0001f;                               // the spin is called out once it's clear it won't be caught
  (void)i;
}

// Hand a car its new rigid-body velocity. A racing car keeps what it can as speed along
// its heading; the rest is a slide and a yaw kick, or, past what can be caught, a spin.
static void physSetVel(Car& c, int i, float vx, float vy, float w, bool forceLoose) {
  if (c.state == CS_RACE) {
    const float ch = cosf(c.heading), sh = sinf(c.heading);
    const float vl = vx * ch + vy * sh;
    const float lx = vx - vl * ch, ly = vy - vl * sh;
    const float yaw = w - c.v * c.kappa;              // the hit's yaw kick (w was this car's driven yaw plus that)
    const float grip = clampf(c.gripNow / A_LAT, 0.25f, 1.2f);
    const float slip = sqrtf(lx * lx + ly * ly);
    // At low speed a yaw kick is easy to gather up; at racing speed it's a handful.
    const float yawLim = PH_YAW_LOOSE * sqrtf(grip) * (1.0f + PH_YAW_SLOW_V / fmx(c.v, 10.0f));
    if (forceLoose || vl < -4.0f || slip > PH_SLIP_LOOSE * grip || fabsf(yaw) > yawLim) {
      if (physDbg) Serial.printf("PH LOOSE %.1f %s force %d vl %.0f v %.0f slip %.1f yaw %.2f grip %.2f\n", raceTime, c.code, (int)forceLoose, vl, c.v, slip, yaw, grip);
      physLoose(c, i, vx, vy, w);
      return;
    }
    c.v = fmx(vl, 0.0f); c.slipVx = lx; c.slipVy = ly; c.yawV = yaw;
  } else if (c.state == CS_SPIN) {
    c.v = sqrtf(vx * vx + vy * vy);
    if (c.v > 0.01f) c.travel = atan2f(vy, vx);
    c.spinV = w;
  } else if (vx * vx + vy * vy > 36.0f || fabsf(w) > 1.0f) {   // stopped (or turning to rejoin): shoved into a slide
    c.state = CS_SPIN;
    c.v = sqrtf(vx * vx + vy * vy);
    c.travel = c.v > 0.01f ? atan2f(vy, vx) : c.heading;
    c.spinV = w;
  }
}

// Moved in the world by (dx, dy): keep the lateral offset the driver steers on in step.
static void physNudge(Car& c, float dx, float dy) {
  c.x += dx; c.y += dy;
  TrackFrame f; trackAt(c.s, f);
  c.d += dx * -f.ty + dy * f.tx;
}

// ─── Each step, for a racing car carrying a slide or a yaw kick ──────────────
static void physRaceSlide(Car& c, float aLatMax, float dt) {
  if (c.slipVx == 0.0f && c.slipVy == 0.0f && c.yawV == 0.0f) return;
  c.x += c.slipVx * dt; c.y += c.slipVy * dt;
  c.heading += c.yawV * dt;
  const float s = sqrtf(c.slipVx * c.slipVx + c.slipVy * c.slipVy);
  const float ns = fmx(0.0f, s - aLatMax * PH_SLIDE_GRIP * dt);
  if (ns < 0.3f) c.slipVx = c.slipVy = 0;
  else { const float k = ns / s; c.slipVx *= k; c.slipVy *= k; }
  c.v = fmx(0.0f, c.v - s * 0.5f * dt);                 // the tyres scrub speed catching it
  c.yawV *= expf(-PH_YAW_DAMP * dt);
  if (fabsf(c.yawV) < 0.02f) c.yawV = 0;
  if (s > 12.0f && frand() < 0.5f) spawnParticle(PT_SMOKE, c.x, c.y, frandr(-0.2f, 0.2f), frandr(-0.2f, 0.2f), 1.8f, 0.09f, 18);
}

// ─── Each step, for a loose car ──────────────────────────────────────────────
// Tyres grip sideways and roll forwards: the slide across the car's heading dies
// fast, the slide along it (brakes locked) more slowly, so a spinning car curves.
static void physSpinStep(Car& c, float aLatMax, float aBrkMax, float dt) {
  float vx = cosf(c.travel) * c.v, vy = sinf(c.travel) * c.v;
  const float ch = cosf(c.heading), sh = sinf(c.heading);
  float vl = vx * ch + vy * sh, vs = -vx * sh + vy * ch;
  const float aL = aBrkMax * 0.55f, aS = aLatMax * 1.25f;
  vl -= clampf(vl, -aL * dt, aL * dt);
  vs -= clampf(vs, -aS * dt, aS * dt);
  vx = vl * ch - vs * sh; vy = vl * sh + vs * ch;
  c.x += vx * dt; c.y += vy * dt;
  c.heading += c.spinV * dt;
  c.spinV *= expf(-0.9f * dt);
  c.spinV -= clampf(c.spinV, -1.2f * dt, 1.2f * dt);
  c.v = sqrtf(vx * vx + vy * vy);
  if (c.v > 0.01f) c.travel = atan2f(vy, vx);
}

// A loose car that's barely rotating, sliding the way it points and still facing
// down the track: the driver has it back.
static bool physCatch(Car& c, int i, float trackAng, float dt) {
  if (c.looseT > 0) {                               // knocked loose: a spin once it's gone on long enough
    c.looseT += dt;
    if (c.looseT > PH_SPIN_CALL) { c.looseT = 0; pushEv(EV_SPIN, i); }
  }
  if (fabsf(c.spinV) > PH_CATCH_YAW || c.v < PH_CATCH_V) return false;
  const float slide = wrapAngle(c.travel - c.heading);
  if (fabsf(slide) > PH_CATCH_ANG || fabsf(wrapAngle(trackAng - c.heading)) > 0.8f) return false;
  c.state = CS_RACE;
  c.v *= cosf(slide);
  c.kappa = 0; c.dPath = c.d;
  c.slipVx = c.slipVy = c.yawV = 0; c.looseT = 0;
  return true;
}

// ─── Damage and what flies off ───────────────────────────────────────────────
static void spawnDebris(float x, float y, float vx, float vy, uint32_t col, int n) {
  for (int k = 0; k < n; ++k) {
    const float a = frand() * 6.2831853f, sp = frandr(0.6f, 2.6f);
    spawnParticle(PT_DEBRIS, x, y, vx * 0.033f + cosf(a) * sp, vy * 0.033f + sinf(a) * sp, frandr(0.6f, 1.1f), 0, irandr(150, 255), col);
  }
}

// dv: the change in speed the impulse caused this car (px/s); (px, py) where it landed.
static float physHit(Car& c, int i, float dv, float px, float py) {
  if (dv < 2.0f) return 0;
  const float ch = cosf(c.heading), sh = sinf(c.heading);
  const float lx = (px - c.x) * ch + (py - c.y) * sh, hl = CLS[c.cls].len * 0.5f;
  float amt = 0;
  if (dv > PH_DV0) {
    amt = 0.9f * powf((dv - PH_DV0) / PH_DV_FULL, PH_DMG_POW) * frandr(0.75f, 1.25f) * CLS_TOUGH[c.cls];
    if (lx > 0.3f * hl)       c.dmgF = fmn(1.0f, c.dmgF + amt);
    else if (lx < -0.3f * hl) c.dmgR = fmn(1.0f, c.dmgR + amt);
    else { c.dmgF = fmn(1.0f, c.dmgF + amt * 0.4f); c.dmgR = fmn(1.0f, c.dmgR + amt * 0.4f); }
    addDamage(c, i, amt);
  }
  const int sparks = clampi((int)(dv / 6.0f), 1, 8);
  for (int k = 0; k < sparks; ++k) spawnParticle(PT_SPARK, px, py, frandr(-1.4f, 1.4f), frandr(-1.4f, 1.4f), 0.8f, 0, irandr(4, 10));
  if (dv > 12.0f) {
    float vx, vy, w; physVel(c, vx, vy, w);
    const int n = clampi((int)((dv - 8.0f) / 7.0f), 1, 7);
    spawnDebris(px, py, vx, vy, c.c1, (n + 1) / 2);
    spawnDebris(px, py, vx, vy, c.c2, n / 2);
    if (dv > 25.0f) for (int k = 0; k < 3; ++k) spawnParticle(PT_SMOKE, px, py, frandr(-0.5f, 0.5f), frandr(-0.5f, 0.5f), 2.2f, 0.14f, 30);
  }
  return amt;
}

// ─── Two cars ────────────────────────────────────────────────────────────────
struct PhBox { float x, y, ax, ay, hl, hw; };      // centre, forward axis, half length and width
static inline PhBox phBox(const Car& c) {
  const ClassSpec& s = CLS[c.cls];
  return { c.x, c.y, cosf(c.heading), sinf(c.heading), s.len * 0.5f, s.wid * 0.5f };
}
static inline void phCorner(const PhBox& b, int k, float& x, float& y) {
  const float l = (k & 1 ? 1.0f : -1.0f) * b.hl, w = (k & 2 ? 1.0f : -1.0f) * b.hw;
  x = b.x + b.ax * l - b.ay * w; y = b.y + b.ay * l + b.ax * w;
}
static inline bool phInside(const PhBox& b, float x, float y, float e) {
  const float rx = x - b.x, ry = y - b.y;
  return fabsf(rx * b.ax + ry * b.ay) <= b.hl + e && fabsf(-rx * b.ay + ry * b.ax) <= b.hw + e;
}

// Separating-axis test. If they overlap: the normal (from a towards b), how deep, and the contact point.
static bool phOverlap(const PhBox& a, const PhBox& b, float& nx, float& ny, float& depth, float& px, float& py) {
  const float dx = b.x - a.x, dy = b.y - a.y;
  const float axes[4][2] = { { a.ax, a.ay }, { -a.ay, a.ax }, { b.ax, b.ay }, { -b.ay, b.ax } };
  depth = 1e9f; nx = 1; ny = 0; int best = 0;
  for (int k = 0; k < 4; ++k) {
    const float ux = axes[k][0], uy = axes[k][1];
    const float ra = a.hl * fabsf(a.ax * ux + a.ay * uy) + a.hw * fabsf(-a.ay * ux + a.ax * uy);
    const float rb = b.hl * fabsf(b.ax * ux + b.ay * uy) + b.hw * fabsf(-b.ay * ux + b.ax * uy);
    const float dist = dx * ux + dy * uy;
    const float o = ra + rb - fabsf(dist);
    if (o <= 0) return false;
    if (o < depth) { depth = o; best = k; nx = dist >= 0 ? ux : -ux; ny = dist >= 0 ? uy : -uy; }
  }
  // Contact point: the middle of the corners that are inside the other car (side by side
  // that's the middle of the overlap, not of either car, so it doesn't twist them).
  float sx = 0, sy = 0; int n = 0;
  for (int k = 0; k < 4; ++k) {
    float x, y;
    phCorner(a, k, x, y); if (phInside(b, x, y, 0.2f)) { sx += x; sy += y; ++n; }
    phCorner(b, k, x, y); if (phInside(a, x, y, 0.2f)) { sx += x; sy += y; ++n; }
  }
  if (n == 0) {                                     // edges crossing: the deepest corner of the other box
    const PhBox& inc = best < 2 ? b : a;
    const float sg = best < 2 ? -1.0f : 1.0f;
    float mx = -1e9f;
    for (int k = 0; k < 4; ++k) {
      float x, y; phCorner(inc, k, x, y);
      const float p = sg * (x * nx + y * ny);
      if (p > mx) { mx = p; sx = x; sy = y; }
    }
    n = 1;
  }
  px = sx / n; py = sy / n;
  return true;
}

static void physPair(int i, int j) {
  Car& a = cars[i]; Car& b = cars[j];
  const float lr = (CLS[a.cls].len + CLS[b.cls].len) * 0.5f + 1.0f;
  if (fabsf(a.x - b.x) > lr || fabsf(a.y - b.y) > lr) return;
  float nx, ny, depth, px, py;
  if (!phOverlap(phBox(a), phBox(b), nx, ny, depth, px, py)) return;
  const float ima = 1.0f / carMass(a), imb = 1.0f / carMass(b);
  const float iIa = 1.0f / carInertia(a), iIb = 1.0f / carInertia(b);

  // Pull them apart (the lighter car moves more)
  const float corr = fmx(depth - PH_SLOP, 0.0f) * PH_PUSH / (ima + imb);
  if (corr > 0) { physNudge(a, -nx * corr * ima, -ny * corr * ima); physNudge(b, nx * corr * imb, ny * corr * imb); }

  // Impulse at the contact point
  float avx, avy, aw, bvx, bvy, bw;
  physVel(a, avx, avy, aw); physVel(b, bvx, bvy, bw);
  const float rax = px - a.x, ray = py - a.y, rbx = px - b.x, rby = py - b.y;
  const float rvx = (bvx - bw * rby) - (avx - aw * ray), rvy = (bvy + bw * rbx) - (avy + aw * rax);
  const float vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;                              // already moving apart
  const float rna = rax * ny - ray * nx, rnb = rbx * ny - rby * nx;
  const float jn = -(1.0f + PH_E_CAR) * vn / (ima + imb + rna * rna * iIa + rnb * rnb * iIb);
  float tx = rvx - vn * nx, ty = rvy - vn * ny, jt = 0;
  const float tl = sqrtf(tx * tx + ty * ty);
  if (tl > 1e-3f) {
    tx /= tl; ty /= tl;
    const float rta = rax * ty - ray * tx, rtb = rbx * ty - rby * tx;
    jt = fmx(-PH_MU_CAR * jn, -tl / (ima + imb + rta * rta * iIa + rtb * rtb * iIb));
  }
  const float Jx = nx * jn + tx * jt, Jy = ny * jn + ty * jt, J = sqrtf(Jx * Jx + Jy * Jy);
  avx -= Jx * ima; avy -= Jy * ima; aw -= (rax * Jy - ray * Jx) * iIa;
  bvx += Jx * imb; bvy += Jy * imb; bw += (rbx * Jy - rby * Jx) * iIb;
  const float dva = J * ima, dvb = J * imb;
  if (physDbg && fmx(dva, dvb) > 20.0f)
    Serial.printf("PH HIT %.1f %s(st %d v %.0f) %s(st %d v %.0f) dv %.0f/%.0f %s dd %.1f g %.1f pass %d/%d\n", raceTime, a.code, (int)a.state, a.v, b.code, (int)b.state, b.v, dva, dvb,
                  fabsf(nx * cosf(a.heading) + ny * sinf(a.heading)) > 0.7f ? "END" : "SIDE", b.d - a.d, sDelta(a.s, b.s), a.passT > 0 ? (int)a.passCar : -1, b.passT > 0 ? (int)b.passCar : -1);
  if (physDbg && fmx(dva, dvb) > 20.0f) {
    const Car& r = sDelta(a.s, b.s) > 0 ? a : b;    // the one behind
    const Car& o = &r == &a ? b : a;                 // the one ahead
    Serial.printf("PH WHY %s vT %.0f follows %d (%s) sc %d scCap %.0f pos %d recov %.1f obstAge %.2f seen %d gap %.0f v %.0f ago %.2f\n", r.code, r.dbgVT, (int)r.dbgAhead,
                  r.dbgAhead >= 0 ? cars[r.dbgAhead].code : "-", (int)scState, scCap[&r - cars], r.pos, r.recoverT,
                  o.obstT > 0 ? raceTime - o.obstT : -1.0f, (int)r.seenObst, r.seenGap, r.seenV, r.seenObst >= 0 ? raceTime - r.seenT : -1.0f);
  }
  physSetVel(a, i, avx, avy, aw, dva > PH_DV_LOOSE);
  physSetVel(b, j, bvx, bvy, bw, dvb > PH_DV_LOOSE);
  physHit(a, i, dva, px, py);
  physHit(b, j, dvb, px, py);
  if (fmx(dva, dvb) > PH_DV_EVENT && a.contactCd <= 0 && b.contactCd <= 0) {
    a.contactCd = b.contactCd = 2.0f;
    const bool aBehind = sDelta(a.s, b.s) > 0;      // the car behind did the hitting
    pushEv(EV_CONTACT, aBehind ? i : j, aBehind ? j : i);
  }
}

static void physCollideCars() {
  for (int i = 0; i < numCars; ++i) {
    if (cars[i].out || cars[i].ghost) continue;      // retired cars are avoided, never hit; the pit lane is apart
    for (int j = i + 1; j < numCars; ++j) {
      if (cars[j].out || cars[j].ghost) continue;
      physPair(i, j);
    }
  }
}

// ─── A car against a barrier ─────────────────────────────────────────────────
static void physWall(Car& c, int i, int side) {
  const TrackPt& p = tp[idxAt(c.s)];
  TrackFrame g; trackAt(c.s, g);
  const float nX = -g.ty, nY = g.tx;               // the +d direction
  const float sg = side ? 1.0f : -1.0f;
  const float face = p.bar[side] - 0.5f;           // the barrier's face (|d|)
  const PhBox b = phBox(c);
  float deep = -1e9f, ox = 0, oy = 0; int n = 0;
  float dk[4], kx[4], ky[4];
  for (int k = 0; k < 4; ++k) {
    float x, y; phCorner(b, k, x, y);
    kx[k] = x - c.x; ky[k] = y - c.y;
    dk[k] = sg * (c.d + kx[k] * nX + ky[k] * nY) - face;
    if (dk[k] > deep) deep = dk[k];
  }
  if (deep <= 0) return;
  for (int k = 0; k < 4; ++k) if (dk[k] > deep - 0.4f) { ox += kx[k]; oy += ky[k]; ++n; }
  ox /= n; oy /= n;
  physNudge(c, -sg * nX * deep, -sg * nY * deep);
  if (c.state == CS_RACE && sg * c.dPath > sg * c.d) c.dPath = c.d;

  const float wx = -sg * nX, wy = -sg * nY;        // the barrier pushes back into the track
  float vx, vy, w; physVel(c, vx, vy, w);
  const float vpx = vx - w * oy, vpy = vy + w * ox;
  const float vn = vpx * wx + vpy * wy;
  if (vn >= 0) return;
  const float im = 1.0f / carMass(c), iI = 1.0f / carInertia(c);
  const float rn = ox * wy - oy * wx;
  const float jn = -(1.0f + PH_E_WALL) * vn / (im + rn * rn * iI);
  float tx = vpx - vn * wx, ty = vpy - vn * wy, jt = 0;
  const float tl = sqrtf(tx * tx + ty * ty);
  if (tl > 1e-3f) {
    tx /= tl; ty /= tl;
    const float rt = ox * ty - oy * tx;
    jt = fmx(-PH_MU_WALL * jn, -tl / (im + rt * rt * iI));
  }
  const float Jx = wx * jn + tx * jt, Jy = wy * jn + ty * jt, J = sqrtf(Jx * Jx + Jy * Jy);
  vx += Jx * im; vy += Jy * im; w += (ox * Jy - oy * Jx) * iI;
  const float dv = J * im;
  physSetVel(c, i, vx, vy, w, dv > PH_DV_LOOSE);
  physHit(c, i, dv, c.x + ox, c.y + oy);
  if (tl > 25.0f) for (int k = 0; k < 2; ++k)       // scraping along it
    spawnParticle(PT_SPARK, c.x + ox, c.y + oy, -tx * frandr(0.5f, 1.5f), -ty * frandr(0.5f, 1.5f), 0.8f, 0, irandr(4, 8));
  if (dv > PH_DV_WALL_EV && c.contactCd <= 0) { c.contactCd = 2.0f; pushEv(EV_WALL, i); }
}
