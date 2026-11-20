#pragma once
// ─── Replays ──────────────────────────────────────────────────────────────────
// The sim records every car's pose after each step into a ring buffer in PSRAM (about 6.5 s). After a big
// moment (a car out of the race, a heavy hit, contact among the front-runners, a pass for the lead that
// sticks) race.h asks for a replay; once REPLAY_POST has gone by, the TV director (ui.h) cuts to it:
// from REPLAY_PRE before the moment to REPLAY_POST after, slowed down around the moment, while the race
// carries on underneath (recording pauses meanwhile). prepareCarsFrame() draws the recorded poses.
// The sim and the renderer's snapshot never run at the same time, so neither side needs a lock.
// (Included from cars.h, after the safety car: needs Car, cars[], numDraw().)

#define REPLAY_FRAMES  196      // about 6.5 s at 30 steps a second
#define REPLAY_PRE     3.5f     // s shown before the moment...
#define REPLAY_POST    2.0f     // ...and after it
#define REPLAY_SLOW    0.45f    // playback speed around the moment
#define REPLAY_SLOW_W  0.9f     // s either side of it at that speed
#define REPLAY_GAP     30.0f    // s of racing between replays, at least (a crash or a heavy hit)...
#define REPLAY_GAP_LO  120.0f   // ...and before replaying a pass for the lead or contact
#define RPF_BRAKE      1
#define RPF_SPIN       2

struct RpCar { float x, y, h; uint8_t flags; };          // 16 bytes
struct RpFrame { float t; int16_t n; RpCar car[MAX_CARS + 1]; };
static RpFrame* rpBuf = nullptr;
static int   rpHead = 0, rpCount = 0;           // where the next frame goes; how many are held
static bool  rpPlaying = false;
static float rpPlayT = 0, rpT0 = 0, rpT1 = 0, rpMoment = 0;   // playback clock and range (raceTime), the moment itself
static int   rpCar = -1;                        // whose moment it is (the camera follows them)
static char  rpText[40] = "";
// A request (sim side): the moment, whose, what, and how much it matters (a retirement beats a pass).
static int   rpReqCar = -1, rpReqPrio = 0;
static float rpReqT = -1;
static char  rpReqText[40] = "";
static float rpLastT = -100;                    // the last moment replayed
static int   rpLeadCand = -1;                   // a new leader: replayed if they're still leading 3 s later
static float rpLeadT = -100, rpLeadPrevT = -100;

static void replayReset() {
  rpHead = rpCount = 0; rpPlaying = false;
  rpReqCar = -1; rpReqPrio = 0; rpLastT = -100;
  rpLeadCand = -1; rpLeadT = rpLeadPrevT = -100;
}

// After each sim step.
static void replayRecord() {
  if (rpPlaying) return;
  if (!rpBuf) {
    rpBuf = (RpFrame*)heap_caps_malloc(sizeof(RpFrame) * REPLAY_FRAMES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!rpBuf) return;
  }
  RpFrame& f = rpBuf[rpHead];
  f.t = raceTime; f.n = (int16_t)numDraw();
  for (int i = 0; i < f.n; ++i) {
    const Car& c = cars[i]; RpCar& r = f.car[i];
    r.x = c.x; r.y = c.y; r.h = c.heading + c.slip;
    r.flags = (c.braking ? RPF_BRAKE : 0) | (c.state == CS_SPIN ? RPF_SPIN : 0);
  }
  rpHead = (rpHead + 1) % REPLAY_FRAMES;
  if (rpCount < REPLAY_FRAMES) ++rpCount;
}

static bool replaysOn = false;                  // (Pi: off for now; RT_REPLAYS=1 or the console's "replays on" turns them on)

static void replayRequest(int car, int prio, float t, const char* text) {
  if (!replaysOn || rpPlaying || raceTime < 6.0f || t - rpLastT < (prio >= 2 ? REPLAY_GAP : REPLAY_GAP_LO) || (rpReqCar >= 0 && prio <= rpReqPrio)) return;
  rpReqCar = car; rpReqPrio = prio; rpReqT = t;
  snprintf(rpReqText, sizeof(rpReqText), "%s", text);
  Serial.printf("RL REPLAY %.1f %s %s\n", t, cars[car].code, text);
}

// Frames by age: k = 0 the oldest.
static inline const RpFrame& rpFrame(int k) { return rpBuf[(rpHead - rpCount + k + 2 * REPLAY_FRAMES) % REPLAY_FRAMES]; }

// The two frames around time t, and how far between them.
static bool replayFrameAt(float t, int& ka, int& kb, float& u) {
  if (!rpBuf || rpCount < 2) return false;
  int k = 0;
  while (k + 2 < rpCount && rpFrame(k + 1).t <= t) ++k;
  ka = k; kb = k + 1;
  const float ta = rpFrame(ka).t, tb = rpFrame(kb).t;
  u = clampf(tb > ta ? (t - ta) / (tb - ta) : 0.0f, 0.0f, 1.0f);
  return true;
}

static void replayPose(int ka, int kb, float u, int i, float& x, float& y, float& h, uint8_t& fl) {
  const RpCar& a = rpFrame(ka).car[i]; const RpCar& b = rpFrame(kb).car[i];
  x = a.x + (b.x - a.x) * u; y = a.y + (b.y - a.y) * u;
  float dh = b.h - a.h;
  while (dh > PI2 * 0.5f) dh -= PI2;
  while (dh < -PI2 * 0.5f) dh += PI2;
  h = a.h + dh * u;
  fl = u < 0.5f ? a.flags : b.flags;
}

// Start playing the requested moment, if it's been recorded (the TV director calls this).
static bool replayStart() {
  if (rpReqCar < 0 || !rpBuf || rpCount < 30) return false;
  const float oldest = rpFrame(0).t, newest = rpFrame(rpCount - 1).t;
  if (newest < rpReqT + REPLAY_POST) return false;            // not yet: keep recording
  rpT0 = fmx(rpReqT - REPLAY_PRE, oldest);
  rpT1 = fmn(rpReqT + REPLAY_POST, newest);
  rpPlayT = rpT0; rpMoment = rpReqT; rpCar = rpReqCar;
  memcpy(rpText, rpReqText, sizeof(rpText));
  rpLastT = rpReqT;
  rpReqCar = -1; rpReqPrio = 0;
  rpPlaying = true;
  return true;
}

// Advance the playback by one camera step; false once it's over (recording starts afresh).
static bool replayStep(float dt) {
  if (!rpPlaying) return false;
  rpPlayT += dt * (fabsf(rpPlayT - rpMoment) < REPLAY_SLOW_W ? REPLAY_SLOW : 1.0f);
  if (rpPlayT < rpT1) return true;
  rpPlaying = false;
  rpHead = rpCount = 0;                         // no gap in the recording: start it again from now
  return false;
}

// Moments worth replaying, from the race's events (race.h).
static void replayNoteLeader(int newLeader) {
  if (raceTime - rpLeadPrevT > 20.0f) { rpLeadCand = newLeader; rpLeadT = raceTime; }   // not one of a back-and-forth
  else rpLeadCand = -1;
  rpLeadPrevT = raceTime;
}
static void replayCheckLeader(int leader) {
  if (rpLeadCand < 0 || raceTime - rpLeadT < 3.0f) return;
  if (leader == rpLeadCand) replayRequest(leader, 1, rpLeadT, "takes the lead");
  rpLeadCand = -1;
}
