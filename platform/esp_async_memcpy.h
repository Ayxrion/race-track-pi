#pragma once
// The ESP32's GDMA memory copier doesn't exist here: installing it fails, and
// the game falls back to its CPU paths (direct map reads, pushImage).
#include "Arduino.h"
typedef void* async_memcpy_handle_t;
struct async_memcpy_event_t { void* data; };
typedef bool (*async_memcpy_isr_cb_t)(async_memcpy_handle_t, async_memcpy_event_t*, void*);
struct async_memcpy_config_t { uint32_t backlog; size_t sram_trans_align, psram_trans_align, dma_burst_size; uint32_t flags; };
#define ASYNC_MEMCPY_DEFAULT_CONFIG() async_memcpy_config_t{ 8, 0, 0, 16, 0 }
static inline esp_err_t esp_async_memcpy_install(const async_memcpy_config_t*, async_memcpy_handle_t* h) { if (h) *h = nullptr; return ESP_ERR_NOT_SUPPORTED; }
static inline esp_err_t esp_async_memcpy(async_memcpy_handle_t, void*, const void*, size_t, async_memcpy_isr_cb_t, void*) { return ESP_ERR_NOT_SUPPORTED; }
