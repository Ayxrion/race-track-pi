/*
 * Race Track — Raspberry Pi / desktop edition
 *
 * The same race as the CrowPanel ESP32 build (copied from race-track f77bd27,
 * the v0.1.21 code), running on Linux or Windows with SDL2. platform/ stands in
 * for the ESP32 parts: threads for the two cores, files for NVS, libcurl for
 * HTTPS. The game headers in src/ are kept as close to the ESP32 copies as
 * possible so fixes can move between the two.
 *
 * Mouse (or touch screen): click a car to follow it, drag to pan, +/− to zoom,
 * list button = leaderboard, gear = settings. Left alone, the TV camera runs.
 * Console: the ESP32's serial test commands (next, finale, shower, replay, shot...).
 */

#include "common.h"
#include "version.h"
#include "wifi_config.h"
#include "ui.h"
#include "telemetry.h"

#include <lgfx/v1/platforms/sdl/Panel_sdl.hpp>

// ─── Presenting strips ────────────────────────────────────────────────────────
// Each finished strip is pushed to the SDL panel. Rows whose pixels didn't
// change since last frame are skipped, as on the ESP32. A copy of the screen
// is kept for the "shot" command.
static uint32_t rowHash[SCREEN_H];
static bool     rowHashValid = false;
static uint32_t rowsCopied = 0;
static uint16_t screenCopy[SCREEN_W * SCREEN_H];

static inline uint32_t hashRow(const uint32_t* p) {
  uint32_t h = 0x9E3779B9u;
  for (int i = 0; i < SCREEN_W / 2; ++i) h = ((h << 5) | (h >> 27)) ^ p[i];
  return h | 1;
}

static void presentStrip(int b, int y, int hh, bool full) {
  int first = -1, last = -1;
  const int h = (y + hh < SCREEN_H ? y + hh : SCREEN_H) - y;
  for (int i = 0; i < h; ++i) {
    if (full) { rowHash[y + i] = 0; if (first < 0) first = i; last = i; continue; }
    const uint32_t hv = hashRow((const uint32_t*)(stripBufs[b] + i * SCREEN_W));
    if (!rowHashValid || hv != rowHash[y + i]) { if (first < 0) first = i; last = i; rowHash[y + i] = hv; }
  }
  if (first < 0) return;
  const int n = last - first + 1;
  rowsCopied += n;
  memcpy(screenCopy + (size_t)(y + first) * SCREEN_W, stripBufs[b] + first * SCREEN_W, (size_t)n * SCREEN_W * 2);
  display.pushImage(0, y + first, SCREEN_W, n, (const lgfx::rgb565_t*)(stripBufs[b] + first * SCREEN_W));
}

static uint32_t lastFrameMs = 0;
static uint32_t fpsFrames = 0, fpsT0 = 0;
static uint32_t profAcc[9] = {0}, profT = 0;
static const char* const PROF_NAMES[9] = { "touch", "prep", "bg", "cars", "fx", "-", "glow", "ui", "push" };
#define PROF(i) do { uint32_t _t = micros(); profAcc[i] += _t - profT; profT = _t; } while (0)

// ─── Splash screens (drawn straight to the panel) ─────────────────────────────
static void splash(const char* msg, const char* sub = nullptr) {
  display.fillScreen(0x101418u);
  for (int x = 0; x < SCREEN_W; x += 16)
    for (int r = 0; r < 2; ++r) display.fillRect(x, 96 + r * 16, 16, 16, ((x / 16 + r) & 1) ? 0xF0F0F0u : 0x101418u);
  display.setTextDatum(textdatum_t::middle_center);
  display.setFont(&fonts::DejaVu40);
  display.setTextColor(0xF04A3Au);
  display.drawString("Race Track", SCREEN_CX, 180);
  display.setFont(&fonts::DejaVu18);
  display.setTextColor(0xD8DEE4u);
  display.drawString(msg, SCREEN_CX, 236);
  if (sub) { display.setFont(&fonts::DejaVu12); display.setTextColor(0x9AA6B0u); display.drawString(sub, SCREEN_CX, 266); }
  display.setFont(&fonts::DejaVu12);
  display.setTextColor(0x6A7680u);
  display.drawString("v" FIRMWARE_VERSION " " PLATFORM_NAME, SCREEN_CX, 440);
}

static void splashProgress(float p) {
  const int x = 220, y = 300, w = 360, h = 10;
  display.drawRoundRect(x, y, w, h, 5, 0x4A545Eu);
  display.fillRoundRect(x + 2, y + 2, (int)((w - 4) * clampf(p, 0, 1)), h - 4, 3, 0xF04A3Au);
}

static void fatal(const char* msg) {
  Serial.println(msg);
  splash(msg);
  for (;;) delay(1000);
}

// ─── Console test commands (the ESP32's serial commands) ──────────────────────
//   finale [laps] · next [laps] · shot · panel <page> [slot] [colours]
//   shower [in] [laps] [wet] · newseason [laps] · replay · telemetry [off]
//   shot saves the screen as shot_<n>.bmp in the data folder.
static int testLaps = 0;

static void saveScreenshot() {
  static int shotNo = 0;
  char path[512];
  snprintf(path, sizeof(path), "%s/shot_%d.bmp", rtDataDir(), shotNo++);
  FILE* f = fopen(path, "wb");
  if (!f) { Serial.printf("SHOT failed (%s)\n", path); return; }
  const int W = SCREEN_W, H = SCREEN_H, rowBytes = W * 3, size = 54 + rowBytes * H;
  uint8_t hdr[54] = { 'B', 'M' };
  auto put32 = [&](int o, uint32_t v) { hdr[o] = v; hdr[o + 1] = v >> 8; hdr[o + 2] = v >> 16; hdr[o + 3] = v >> 24; };
  put32(2, size); put32(10, 54); put32(14, 40); put32(18, W); put32(22, (uint32_t)-H);   // top-down
  hdr[26] = 1; hdr[28] = 24; put32(34, rowBytes * H);
  fwrite(hdr, 1, 54, f);
  static uint8_t row[SCREEN_W * 3];
  for (int y = 0; y < H; ++y) {
    for (int x = 0; x < W; ++x) {
      const uint32_t c = c565ToRgb(screenCopy[y * W + x]);
      row[x * 3] = cB(c); row[x * 3 + 1] = cG(c); row[x * 3 + 2] = cR(c);
    }
    fwrite(row, 1, rowBytes, f);
  }
  fclose(f);
  Serial.printf("SHOT saved %s\n", path);
}

static void handleSerialCmd(char* s) {
  char* tok[4] = { nullptr }; int nt = 0;
  for (char* t = strtok(s, " "); t && nt < 4; t = strtok(nullptr, " ")) tok[nt++] = t;
  if (!nt) return;
  const int a1 = nt > 1 ? (int)strtol(tok[1], nullptr, 0) : 0, a2 = nt > 2 ? (int)strtol(tok[2], nullptr, 0) : 0;
  if (!strcmp(tok[0], "finale")) { testLaps = clampi(a1, 0, 99); champTestFinale(carSetting); nextRaceRequested = true; }
  else if (!strcmp(tok[0], "next")) { testLaps = clampi(a1, 0, 99); nextRaceRequested = true; Serial.println("Test: next race"); }
  else if (!strcmp(tok[0], "shot")) saveScreenshot();
  else if (!strcmp(tok[0], "physics")) {
    if (nt > 1) physOn = a1 != 0;
    Serial.printf("Physics: %s\n", physOn ? "rigid-body contact" : "the ESP32's scripted contact");
  }
  else if (!strcmp(tok[0], "speed")) { simSpeed = clampi(nt > 1 ? a1 : 1, 1, 16); Serial.printf("Speed: %dx\n", simSpeed); }
  else if (!strcmp(tok[0], "telemetry")) {
    if (nt > 1 && !strcmp(tok[1], "off")) telemetryForget();
    else Serial.printf("Telemetry: %s\n", telemetryReady ? "publishing" : "off");
  }
  else if (!strcmp(tok[0], "shower")) {
    const float prog = cars[order[0]].dist / trk.L;
    showerFrom = prog + (nt > 1 ? atof(tok[1]) : 0.0f);
    showerTo = showerFrom + (nt > 2 ? atof(tok[2]) : 3.0f);
    showerLevel = nt > 3 ? clampf(atof(tok[3]), 0.1f, 1.0f) : 1.0f;
    showerStorm = false;
    Serial.printf("Test: shower from lap %.1f to %.1f, wet %.2f\n", showerFrom, showerTo, showerLevel);
  }
  else if (!strcmp(tok[0], "replay")) {
    rpLastT = -100; replayRequest(order[0], 9, raceTime - 1.0f, "test replay");
    Serial.printf("Test: replay requested (%s)\n", rpReqCar >= 0 ? "ok" : "not now");
  }
  else if (!strcmp(tok[0], "replays")) {
    replaysOn = !(nt > 1 && !strcmp(tok[1], "off"));
    if (!replaysOn) rpReqCar = -1;
    Serial.printf("Replays %s\n", replaysOn ? "on" : "off");
  }
  else if (!strcmp(tok[0], "newseason")) {
    testLaps = clampi(a1, 0, 99); champTest = true; champTestRan = false; champ.raceNo = SEASON_RACES; nextRaceRequested = true;
    Serial.println("Test: the next race starts a new season (nothing will be saved)");
  }
  else if (!strcmp(tok[0], "panel")) {
    if (nt < 2 || a1 < 0) { panelOpen = false; panelPage = 0; }
    else {
      panelOpen = true; panelPage = clampi(a1, 0, 4);
      editSlot = clampi(a2, 0, MAX_CARS - 1);
      editLiv = nt > 3 ? (uint8_t)strtol(tok[3], nullptr, 0) : customLivery[editSlot];
      memcpy(editBuf, customCode[editSlot], 4); editBuf[3] = 0;
    }
    Serial.printf("Test: panel %s page %d\n", panelOpen ? "open" : "closed", panelPage);
  }
  else Serial.printf("Commands: finale [laps], next [laps], shot, physics [0|1], speed [1-16], panel <page> [slot] [colours], shower [in] [laps] [wet], newseason [laps], replay (got '%s')\n", tok[0]);
}
static void pollSerialCmd() {
  static char buf[40]; static int n = 0;
  while (Serial.available() > 0) {
    const int ch = Serial.read();
    if (ch == '\n' || ch == '\r') { buf[n] = 0; if (n) handleSerialCmd(buf); n = 0; }
    else if (n < (int)sizeof(buf) - 1) buf[n++] = (char)ch;
  }
}

static void beginNextRace() {
  int sel; uint32_t seed; uint8_t series;
  pickNextRace(sel, seed, series);
  splash(sel >= 0 ? PRESETS[sel].name : "Building a new circuit...", sel >= 0 ? PRESETS[sel].place : nullptr);
  uint32_t t0 = millis();
  generateWorld(sel, seed, splashProgress);
  Serial.printf("World generated in %lu ms\n", (unsigned long)(millis() - t0));
  raceLaps = LAPS_OPTS[lapsIdx];
  if (testLaps > 0) { raceLaps = testLaps; testLaps = 0; }
  if (const char* e = getenv("RT_LAPS")) raceLaps = atoi(e);            // (tuning: race length for test runs)
  champPrepareRace(carSetting, series, raceLaps);
  startRace(carSetting, series, seed);
  champGridTicker();
  char sub[64];
  if (raceLaps > 0) snprintf(sub, sizeof(sub), "%s  -  %d cars  -  %d laps", SERIES_NAMES[series], numCars, raceLaps);
  else              snprintf(sub, sizeof(sub), "%s  -  %d cars", SERIES_NAMES[series], numCars);
  splash(trk.name, sub);
  delay(1200);
  cam.zoom = ZOOM_MIN; cam.x = WORLD_W * 0.5f; cam.y = WORLD_H * 0.5f; cam.vx = cam.vy = 0; cam.animZoom = false;
  followCar = -1; tv.until = 0;
  if (spectator || millis() - lastTouchMs > AUTOCAM_IDLE_MS) autoCam = true;
  updateLighting(true);
  rowHashValid = false;
  telemetryNewRace();
}

// ─── Simulation thread (core 0 on the ESP32) ──────────────────────────────────
static SemaphoreHandle_t simKick = nullptr, simDone = nullptr;
static volatile int      simSteps = 0;
static bool              simBusy = false;
static uint32_t          simUs = 0;

static void simTask(void*) {
  for (;;) {
    xSemaphoreTake(simKick, portMAX_DELAY);
    uint32_t t0 = micros();
    for (int k = 0; k < simSteps; ++k) {
      simTime += FRAME_MS / 1000.0f;
      updateRace(FRAME_MS / 1000.0f);
      updateParticles();
      updateStandFlashes();
    }
    simUs = micros() - t0;
    xSemaphoreGive(simDone);
  }
}
static void startSimTask() {
  simKick = xSemaphoreCreateBinary();
  simDone = xSemaphoreCreateBinary();
  xTaskCreatePinnedToCore(simTask, "sim", 0, nullptr, 2, nullptr, 0);
}
static void simJoin()           { if (simBusy) { xSemaphoreTake(simDone, portMAX_DELAY); simBusy = false; } }
static void simStart(int steps) { if (steps <= 0) return; simSteps = steps; simBusy = true; xSemaphoreGive(simKick); }

void setup() {
  _rng = esp_random() | 1u;
  Serial.printf("Race Track v%s (%s edition)\n", FIRMWARE_VERSION, PLATFORM_NAME);
  if (const char* e = getenv("RACE_TRACK_PHYSICS")) { physOn = atoi(e) != 0; physDbg = atoi(e) == 2; }
  if (const char* e = getenv("RACE_TRACK_SPEED")) simSpeed = clampi(atoi(e), 1, 16);
  if (const char* e = getenv("RT_FOLLOW_T")) followT = atof(e);       // tuning
  if (const char* e = getenv("RT_PASS_BAND")) passBand = atof(e);
  if (const char* e = getenv("RT_PASS_SWITCH")) passSwitch = atoi(e) != 0;
  if (const char* e = getenv("RT_REPLAYS")) replaysOn = atoi(e) != 0;  // 0: no replays
  if (const char* e = getenv("RT_OBST_FIX")) obstFix = atoi(e);
  if (const char* e = getenv("RT_PACK_FAR")) sscanf(e, "%f:%f", &packFarK, &packFarG);   // tuning: far catch-up "k:g"
  if (const char* e = getenv("RT_PACK")) sscanf(e, "%f:%f", &packKPh, &packGripK);
  if (const char* e = getenv("RT_REPAIR")) sscanf(e, "%f:%f", &repairLo, &repairHi);
  if (const char* e = getenv("RT_LAP1")) sscanf(e, "%f:%f", &lap1K, &lap1Laps);
  if (const char* e = getenv("RT_STRAT")) { const int v = atoi(e); tyreStrat = v != 0; forceStrat = v >= 2 ? v - 2 : -1; }   // tuning: 0 old tyres, 1 strategies, 2+k everyone on STRATS[k]
  if (const char* e = getenv("RT_TYRE")) sscanf(e, "%f:%f:%f", &tcGrip[0], &tcGrip[2], &twLin);
  if (const char* e = getenv("RT_LANE_MAX")) laneMax = atof(e);
  if (const char* e = getenv("RT_LANE_REFV")) laneRefV = atof(e);
  if (const char* e = getenv("RT_F_LEN")) CLS[CC_FORMULA].len = atof(e);
  if (const char* e = getenv("RT_F_TOP")) CLS[CC_FORMULA].top = atof(e);
  if (const char* e = getenv("RT_F_GRIP")) CLS[CC_FORMULA].grip = atof(e);
  if (const char* e = getenv("RT_F_ACC")) CLS[CC_FORMULA].acc = atof(e);
  if (const char* e = getenv("RT_CLS_GRIP")) { int k; float g; if (sscanf(e, "%d:%f", &k, &g) == 2 && k >= 0 && k < CC_COUNT) CLS[k].grip = g; }   // tuning: "4:0.76"
  if (const char* e = getenv("RT_CLS_WID")) { int k; float w; if (sscanf(e, "%d:%f", &k, &w) == 2 && k >= 0 && k < CC_COUNT) CLS[k].wid = w; }
  if (const char* e = getenv("RT_F_LIKE")) { const int k = atoi(e); CLS[CC_FORMULA].top = CLS[k].top; CLS[CC_FORMULA].grip = CLS[k].grip; CLS[CC_FORMULA].acc = CLS[k].acc; }
  if (const char* e = getenv("RT_TRACK_W")) trackWDef = atof(e);
  if (getenv("RT_TRACK_SURVEY")) {                   // tuning: how wide each circuit can be, and how often a generated one fits
    allocWorld();
    // (and per class, the share of each lap flat out, where the tow works)
    auto flatShare = [](const char* nm) {
      char b[200]; int n = snprintf(b, sizeof(b), "FLAT %-24s", nm);
      for (int k = 0; k < CC_COUNT; ++k) {
        int f = 0; const float need = V_TOP * CLS[k].top * FLAT_OUT / sqrtf(CLS[k].grip);
        for (int i = 0; i < trk.n; ++i) f += tp[i].vc >= need;
        n += snprintf(b + n, sizeof(b) - n, " %s %.0f%%", CLS[k].name, 100.0f * f / trk.n);
      }
      Serial.printf("%s\n", b);
    };
    for (int p = 0; p < NUM_PRESETS; ++p) { buildPresetTrack(p); flatShare(trk.name); }
    for (uint32_t s = 1; s <= 6; ++s) { buildRandomTrack(s * 7919u); flatShare(trk.name); }
    int fit = 0;
    for (uint32_t s = 1; s <= 30; ++s) { buildRandomTrack(s * 7919u); if (trk.preset < 0) ++fit; }
    Serial.printf("SURVEY width %.0f: %d of 30 generated tracks fit\n", trackWDef, fit);
    fflush(stdout); exit(0);
  }
  Serial.printf("Physics: %s\n", physOn ? "rigid-body contact" : "the ESP32's scripted contact");
  Serial.printf("Saves in %s/\n", rtDataDir());

  display.init();
  display.setRotation(0);
  display.setBrightness(200);
  loadSettings();
  if (const char* e = getenv("RT_TRACKMODE")) trackMode = (uint8_t)atoi(e);   // (tuning: 1 = generated tracks only)
  champLoad();
  display.setBrightness(brightness);

  for (int i = 0; i < 2; ++i) {
    stripBufs[i] = (uint16_t*)heap_caps_aligned_alloc(64, SCREEN_W * STRIP_H * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
    if (!stripBufs[i]) fatal("Strip buffer allocation failed");
  }
  canvas.setColorDepth(lgfx::color_depth_t::rgb565_nonswapped);
  beginStrip(0);
  if (!allocWorld()) fatal("World allocation failed");
  initBgPrefetch();

  telemetryInit();
  initWeather();
  initDayNight();
  lastTouchMs = millis() - AUTOCAM_IDLE_MS - 1;      // start with the TV camera
  beginNextRace();

  startSimTask();
  startTouchTask();
  lastFrameMs = fpsT0 = millis();
}

// ─── Which rows need rendering (unchanged from the ESP32 build) ───────────────
static uint8_t dynNow[SCREEN_H], dynPrev[SCREEN_H];
static void markRows(int y0, int y1) {
  y0 = clampi(y0, 0, SCREEN_H - 1); y1 = clampi(y1, 0, SCREEN_H - 1);
  if (y1 >= y0) memset(dynNow + y0, 1, y1 - y0 + 1);
}
static void markDynamicRows() {
  memset(dynNow, 0, sizeof(dynNow));
  for (int i = 0; i < drawN; ++i) if (cdraw[i].vis) markRows(cdraw[i].y0, cdraw[i].y1);
  for (int i = 0; i < pdN; ++i) markRows(pd[i].y0 - 2, pd[i].y1 + 2);
  uiDynamicRows(markRows);
}

struct Chunk { int16_t y, h; };
static Chunk chunks[SCREEN_H / 4];
static uint32_t rowsRendered = 0;

void loop() {
  simJoin();
  champTick();
  pollSerialCmd();
  if (nextRaceRequested) { beginNextRace(); lastFrameMs = millis(); }

  uint32_t now = millis();
  if (now - lastFrameMs < FRAME_MS) { delay(1); return; }
  lastFrameMs = now;
  ++frameCount;
  const uint32_t frameUs0 = micros();

  profT = micros();
  pollTouch();
  PROF(0);

  static uint32_t simMs = now;
  int steps = 0;
  while ((int32_t)(now - simMs) >= FRAME_MS && steps < 4) {
    simMs += FRAME_MS; ++steps;
    updateTvCam();
    updateCamera();
    updateWeatherFx();
  }
  if ((int32_t)(now - simMs) >= FRAME_MS) simMs = now;
  steps *= simSpeed;                                 // fast-forward (testing)
  updateLighting();
  telemetryCapture();

  int camCar = cameraCar();
  prepareBackground();
  prepareCarsFrame();
  prepareUI();
  snapshotParticles();
  if (rpPlaying) pdN = 0;
  markDynamicRows();
  simStart(steps);
  PROF(1);

  static float lastCamX = -1, lastCamY = -1, lastCamZ = -1;
  static bool  lastHud = true;
  bool full = !rowHashValid || palChanged || cam.x != lastCamX || cam.y != lastCamY || cam.zoom != lastCamZ ||
              hudOn != lastHud || numDrops > 0 || numFlakes > 0 || fogMix > 0.08f;
  lastCamX = cam.x; lastCamY = cam.y; lastCamZ = cam.zoom; lastHud = hudOn;
  palChanged = false;
  int nChunks = 0;
  for (int y = 0; y < SCREEN_H && nChunks < (int)(sizeof(chunks) / sizeof(chunks[0])); ) {
    if (!full && !dynNow[y] && !dynPrev[y]) { ++y; continue; }
    int y0 = y;
    while (y < SCREEN_H && y - y0 < stripH) {
      if (full || dynNow[y] || dynPrev[y]) { ++y; continue; }
      int z = y;
      while (z < SCREEN_H && z - y < 6 && !dynNow[z] && !dynPrev[z]) ++z;
      if (z < SCREEN_H && z - y < 6 && z - y0 < stripH) y = z; else break;
    }
    chunks[nChunks++] = { (int16_t)y0, (int16_t)(y - y0) };
  }
  memcpy(dynPrev, dynNow, sizeof(dynNow));

  if (nChunks > 0) prefetchStrip(chunks[0].y, chunks[0].h);
  display.startWrite();
  for (int k = 0, b = 0; k < nChunks; ++k, b ^= 1) {
    const int y = chunks[k].y, h = chunks[k].h;
    PROF(8);
    beginStrip(y, b, h);
    renderBackground();
    if (k + 1 < nChunks) prefetchStrip(chunks[k + 1].y, chunks[k + 1].h);
    PROF(2);
    drawCarShadows();
    drawHeadlights();
    drawCars(camCar);
    PROF(3);
    drawParticles();
    PROF(4);
    drawLightGlows();
    drawWeatherFx();
    PROF(6);
    drawUI();
    PROF(7);
    presentStrip(b, y, h, full);
    rowsRendered += h;
    PROF(8);
  }
  display.endWrite();
  rowHashValid = true;
  PROF(8);

  static uint32_t workUs = 0, workMax = 0;
  { const uint32_t w = micros() - frameUs0; workUs += w; if (w > workMax) workMax = w; }
  ++fpsFrames;
  if (now - fpsT0 >= 10000) {
    Serial.printf("fps %.1f  zoom %.2f  cars %d  lap %d  sim %.2f ms  work avg %.1f max %.1f ms  rows %u/%u\n",
                  fpsFrames * 1000.0f / (now - fpsT0), cam.zoom, numCars, leaderLapDisplay(), simUs / 1000.0f,
                  workUs / 1000.0f / fpsFrames, workMax / 1000.0f,
                  (unsigned)(rowsRendered / fpsFrames), (unsigned)(rowsCopied / fpsFrames));
    for (int i = 0; i < 9; ++i) profAcc[i] = 0;
    for (int i = 0; i < 8; ++i) uiProf[i] = 0;
    bgWaitUs = 0; rowsCopied = rowsRendered = 0; workUs = workMax = 0;
    fpsFrames = 0; fpsT0 = now;
  }
}

// ─── Entry point: SDL owns the main thread, the game runs on its own ─────────
static int gameMain(bool* running) {
  setup();
  while (*running) loop();
  return 0;
}

int main(int, char**) {
  setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
  SDL_SetMainReady();
  return lgfx::Panel_sdl::main(gameMain);
}
