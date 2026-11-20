#pragma once
// Local development builds may keep their existing weather configuration.
// Clean public builds work without a private header; the OS handles networking.
#if __has_include("wifi_config.h")
#include "wifi_config.h"
#else
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define WEATHER_API_KEY ""
#define WEATHER_LAT ""
#define WEATHER_LON ""
#define TIMEZONE_OFFSET_HOURS 0
#endif
