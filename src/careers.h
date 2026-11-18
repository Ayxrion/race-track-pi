#pragma once
// ─── Careers ──────────────────────────────────────────────────────────────────
// Every driver who races in the championship has a career: an age, a pace, a skill and a talent (how
// much they can still improve). Between seasons everyone gets a year older: young drivers improve,
// drivers in their prime hold steady give or take, and veterans slowly fade. In the standard field
// (Custom drivers off) veterans retire and rookies with new names take their seats; the user's own
// drivers never retire and never age (a season goes by in about 80 minutes, so they would be pensioners
// within days): their form rises and falls from season to season around the middle of the field instead.
// champ.h saves it to flash and calls careerNewSeason().
// (Included from cars.h, after seasonAbility(); needs DRIVER_CODES, customCode and frand.)

#define CAREER_MAX     48       // drivers remembered (retired ones make room for new ones)
#define CAREER_VER     1
#define CR_RETIRED     1
#define CR_ROOKIE      2        // came in as a rookie (shown as one in their first season)
#define RETIRE_MAX     3        // retirements per season, at most
struct CareerRow { char code[4]; uint8_t age, seasons, perfQ, skillQ, talent, flags; uint8_t pad[2]; };   // 12 bytes
struct CareerBlob { uint16_t ver, n; uint16_t season; uint8_t pad[2]; char stdCode[MAX_CARS][4]; CareerRow row[CAREER_MAX]; };
static CareerBlob career;
static bool career_ok = false;          // started (or loaded): abilities come from here, not from the season seed
static char careerNews[56] = "";        // the new season's comings and goings, for the grid ticker

// Invented codes for rookies (none of them a real driver's).
static const char* const ROOKIE_CODES[] = {
  "ABE", "BRK", "CAL", "DEX", "ELO", "FAR", "GRI", "HOL", "IVO", "JUN", "KEL", "LOR", "MOL", "NAV", "ORT", "PAZ",
  "QUI", "RAV", "SAV", "TAL", "ULL", "VEX", "WEB", "XAN", "YAR", "ZEL", "ALD", "BEX", "CEL", "DUN", "EZR", "FIN",
  "GAL", "HAN", "ILE", "JAX", "KOV", "LUX", "MER", "NIX" };
#define NUM_ROOKIE_CODES ((int)(sizeof(ROOKIE_CODES) / sizeof(ROOKIE_CODES[0])))

static inline bool crSame(const char* a, const char* b) { return a[0] == b[0] && a[1] == b[1] && a[2] == b[2]; }
static inline float crPerf(const CareerRow& r)  { return 0.985f + r.perfQ * 0.0001f; }
static inline float crSkill(const CareerRow& r) { return 0.86f + r.skillQ * 0.001f; }
static inline void crSet(CareerRow& r, float perf, float skill) {
  r.perfQ  = (uint8_t)clampi((int)lroundf((clampf(perf, 0.985f, 1.002f) - 0.985f) / 0.0001f), 0, 170);
  r.skillQ = (uint8_t)clampi((int)lroundf((clampf(skill, 0.86f, 0.99f) - 0.86f) / 0.001f), 0, 130);
}

// A fresh start: the standard field's seats go to the standard names.
static void careerReset() {
  memset(&career, 0, sizeof(career));
  career.ver = CAREER_VER;
  for (int i = 0; i < MAX_CARS; ++i) { memcpy(career.stdCode[i], DRIVER_CODES[i % NUM_CODES], 3); career.stdCode[i][3] = 0; }
  career_ok = true;
}

static bool isCustomCode(const char* code) {
  for (int i = 0; i < MAX_CARS; ++i) if (customCode[i][0] && crSame(customCode[i], code)) return true;
  return false;
}

static CareerRow* careerNewRow(const char* code) {
  int k = -1;
  if (career.n < CAREER_MAX) k = career.n++;
  else for (int j = 0; j < CAREER_MAX && k < 0; ++j) if (career.row[j].flags & CR_RETIRED) k = j;   // a retired driver's place
  if (k < 0) return nullptr;
  CareerRow& r = career.row[k];
  memset(&r, 0, sizeof(r));
  memcpy(r.code, code, 3); r.code[3] = 0;
  return &r;
}

// A driver's career, or the start of one: their ability as it is this season (so nothing changes mid-season
// when careers first appear), an age from 21 to 33 and a talent.
static CareerRow* careerFind(const char* code, bool add, uint32_t seed) {
  for (int k = 0; k < career.n; ++k) if (crSame(career.row[k].code, code)) return &career.row[k];
  if (!add) return nullptr;
  CareerRow* r = careerNewRow(code);
  if (!r) return nullptr;
  float p, s; seasonAbility(code, seed, p, s); crSet(*r, p, s);
  const uint32_t h = hash32(codeHash(code) * 2654435761u + 0x51u);
  r->age = (uint8_t)(21 + h % 13);
  r->talent = (uint8_t)((h >> 8) % 100);
  return r;
}

// This season's pace and skill for a driver (starting a career if they haven't one).
static void careerAbility(const char* code, uint32_t seed, float& perf, float& skill) {
  const CareerRow* r = career_ok ? careerFind(code, true, seed) : nullptr;
  if (r) { perf = crPerf(*r); skill = crSkill(*r); }
  else seasonAbility(code, seed, perf, skill);
}

static bool codeInUse(const char* code) {
  if (isCustomCode(code)) return true;
  for (int i = 0; i < MAX_CARS; ++i) if (crSame(career.stdCode[i], code)) return true;
  for (int k = 0; k < career.n; ++k) if (!(career.row[k].flags & CR_RETIRED) && crSame(career.row[k].code, code)) return true;
  return false;
}

static const char* pickRookieCode() {
  const int k0 = (int)(frand() * NUM_ROOKIE_CODES);
  for (int j = 0; j < NUM_ROOKIE_CODES; ++j) { const char* c = ROOKIE_CODES[(k0 + j) % NUM_ROOKIE_CODES]; if (!codeInUse(c)) return c; }
  for (int j = 0; j < NUM_CODES; ++j) { const char* c = DRIVER_CODES[j]; if (!codeInUse(c)) return c; }
  return nullptr;
}

// A year on. Returns how many drivers retired (careerNews says who, and who came in).
static int careerNewSeason() {
  ++career.season;
  careerNews[0] = 0;
  // Everyone gets a year older: a young driver improves (more so with talent), one in their prime holds
  // steady give or take, and a veteran slowly loses pace and sharpness.
  for (int k = 0; k < career.n; ++k) {
    CareerRow& r = career.row[k];
    if (r.flags & CR_RETIRED) continue;
    if (r.seasons < 255) ++r.seasons;
    const float t = r.talent / 100.0f, perf = crPerf(r), skill = crSkill(r);
    float dp, ds;
    if (isCustomCode(r.code)) {                              // the user's own: up and down, drawn back toward the middle
      dp = frandr(-0.0022f, 0.0022f) + 0.1f * (0.994f - perf);
      ds = frandr(-0.020f, 0.020f) + 0.1f * (0.925f - skill);
      crSet(r, perf + dp, skill + ds);
      continue;
    }
    if (r.age < 60) ++r.age;
    if (r.age <= 23)      { dp = frandr(0.0005f, 0.0030f) * (0.5f + t); ds = frandr(0.002f, 0.014f); }
    else if (r.age <= 28) { dp = frandr(-0.0008f, 0.0016f) + 0.0008f * (t - 0.5f); ds = frandr(-0.004f, 0.010f); }
    else if (r.age <= 32) { dp = frandr(-0.0018f, 0.0008f); ds = frandr(-0.006f, 0.005f); }
    else                  { dp = frandr(-0.0035f, 0.0003f); ds = frandr(-0.012f, 0.003f); }
    if (dp > 0) dp *= clampf((1.002f - perf) / 0.006f, 0.2f, 1.0f);   // harder to find more near the top
    crSet(r, perf + dp, skill + ds);
  }
  // The standard field: veterans (and the odd driver who never got going) retire, and rookies come in.
  char gone[RETIRE_MAX][4], came[RETIRE_MAX][4]; int nOut = 0;
  for (int i = 0; i < MAX_CARS && nOut < RETIRE_MAX; ++i) {
    const char* code = career.stdCode[i];
    if (!code[0] || isCustomCode(code)) continue;            // the user's own drivers never retire
    CareerRow* r = careerFind(code, false, 0);
    if (!r) continue;                                        // never raced: nothing to retire from
    float p = 0;
    if (r->age >= 32) p = 0.10f + 0.12f * (r->age - 32);
    else if (r->age >= 29 && crPerf(*r) < 0.9885f) p = 0.08f;
    if (frand() >= p) continue;
    const char* nc = pickRookieCode();
    if (!nc) break;
    r->flags |= CR_RETIRED;
    memcpy(gone[nOut], code, 4);
    memcpy(career.stdCode[i], nc, 3); career.stdCode[i][3] = 0;
    CareerRow* nr = careerNewRow(nc);
    if (nr) {
      nr->age = (uint8_t)(19 + (int)(frand() * 4)); nr->flags = CR_ROOKIE;
      nr->talent = (uint8_t)(frand() * 100);
      crSet(*nr, frandr(0.986f, 0.994f), frandr(0.86f, 0.93f));
    }
    memcpy(came[nOut], nc, 4);
    ++nOut;
  }
  if (nOut == 1) snprintf(careerNews, sizeof(careerNews), "%.3s retires - rookie %.3s takes the seat", gone[0], came[0]);
  else if (nOut == 2) snprintf(careerNews, sizeof(careerNews), "%.3s and %.3s retire - rookies %.3s and %.3s", gone[0], gone[1], came[0], came[1]);
  else if (nOut >= 3) snprintf(careerNews, sizeof(careerNews), "%.3s, %.3s, %.3s retire - 3 rookies join", gone[0], gone[1], gone[2]);
  return nOut;
}
