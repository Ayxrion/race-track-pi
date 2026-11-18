#pragma once
// No DMA here, so there is no cache to keep in step with it.
#include "Arduino.h"
#define ESP_CACHE_MSYNC_FLAG_INVALIDATE (1 << 0)
#define ESP_CACHE_MSYNC_FLAG_UNALIGNED  (1 << 1)
#define ESP_CACHE_MSYNC_FLAG_DIR_C2M    (1 << 2)
#define ESP_CACHE_MSYNC_FLAG_DIR_M2C    (1 << 3)
static inline esp_err_t esp_cache_msync(void*, size_t, int) { return ESP_OK; }
