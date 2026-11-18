#pragma once
// ═══════════════════════════════════════════════════════════════════════════════
//  LGFX on SDL2: an 800×480 window on a PC, or full screen on the Pi.
//  The game draws exactly as on the CrowPanel; LovyanGFX's SDL panel puts the
//  frame on screen and turns the mouse (or a touch screen) into touches.
//
//  Environment:
//    RACE_TRACK_SCALE=2     window at 2× (1600×960); default 1
// ═══════════════════════════════════════════════════════════════════════════════

#define LGFX_USE_V1
#include <LovyanGFX.hpp>
#include <lgfx/v1/platforms/sdl/Panel_sdl.hpp>
#include <cstdlib>

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_sdl _panel;

  bool init_impl(bool /*use_reset*/, bool use_clear) { return LGFX_Device::init_impl(false, use_clear); }

public:
  LGFX() {
    auto cfg = _panel.config();
    cfg.memory_width = cfg.panel_width = 800;
    cfg.memory_height = cfg.panel_height = 480;
    _panel.config(cfg);
    int s = 1;
    if (const char* e = getenv("RACE_TRACK_SCALE")) s = atoi(e);
    if (s < 1 || s > 4) s = 1;
    _panel.setScaling(s, s);
    _panel.setWindowTitle("Race Track");
    setPanel(&_panel);
    _board = lgfx::board_t::board_SDL;
  }
  // The ESP32 build DMA-copies strips straight into the panel framebuffer;
  // here every strip goes through pushImage instead.
  uint8_t* frameLine(int) const { return nullptr; }
};
