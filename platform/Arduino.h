#pragma once
// ═══════════════════════════════════════════════════════════════════════════════
//  The small slice of Arduino-ESP32 + FreeRTOS that the race code uses, on top
//  of standard C++ (Linux on the Raspberry Pi, or Windows/MinGW for development).
//  The game headers in src/ are copied from the ESP32 project and include
//  <Arduino.h> as usual; this file stands in for it.
// ═══════════════════════════════════════════════════════════════════════════════

#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdarg>
#include <cmath>
#include <ctime>
#include <string>
#include <algorithm>

#define IRAM_ATTR
#define DRAM_ATTR
#define EXT_RAM_ATTR

#ifndef PI
#define PI 3.1415926535897932384626433832795
#endif

// ─── Time ─────────────────────────────────────────────────────────────────────
uint32_t millis();
uint32_t micros();
void     delay(uint32_t ms);
void     delayMicroseconds(uint32_t us);
static inline void yield() {}

// ─── Random ───────────────────────────────────────────────────────────────────
uint32_t esp_random();
static inline long random(long hi) { return hi > 0 ? (long)(esp_random() % (uint32_t)hi) : 0; }
static inline long random(long lo, long hi) { return hi > lo ? lo + random(hi - lo) : lo; }
static inline void randomSeed(unsigned long) {}

// ─── esp_err_t ────────────────────────────────────────────────────────────────
typedef int esp_err_t;
#define ESP_OK                 0
#define ESP_FAIL              -1
#define ESP_ERR_NO_MEM         0x101
#define ESP_ERR_INVALID_ARG    0x102
#define ESP_ERR_INVALID_STATE  0x103
#define ESP_ERR_NOT_SUPPORTED  0x106
const char* esp_err_to_name(esp_err_t e);

// ─── String (just what the game, weather and telemetry code use) ─────────────
class String {
public:
  String() {}
  String(const char* s) : s_(s ? s : "") {}
  String(const std::string& s) : s_(s) {}
  String(char c) : s_(1, c) {}
  String(int v)           : s_(std::to_string(v)) {}
  String(unsigned v)      : s_(std::to_string(v)) {}
  String(long v)          : s_(std::to_string(v)) {}
  String(unsigned long v) : s_(std::to_string(v)) {}
  String(float v, int dec = 2)  { char b[32]; snprintf(b, sizeof(b), "%.*f", dec, v); s_ = b; }
  String(double v, int dec = 2) { char b[32]; snprintf(b, sizeof(b), "%.*f", dec, v); s_ = b; }

  const char* c_str() const { return s_.c_str(); }
  unsigned length() const { return (unsigned)s_.size(); }
  bool isEmpty() const { return s_.empty(); }
  char operator[](unsigned i) const { return i < s_.size() ? s_[i] : 0; }
  char charAt(unsigned i) const { return (*this)[i]; }
  bool concat(const char* s) { if (s) s_ += s; return true; }
  bool concat(const String& s) { s_ += s.s_; return true; }
  bool concat(char c) { s_ += c; return true; }
  String& operator+=(const String& o) { s_ += o.s_; return *this; }
  String& operator+=(const char* o) { if (o) s_ += o; return *this; }
  String& operator+=(char c) { s_ += c; return *this; }
  bool operator==(const String& o) const { return s_ == o.s_; }
  bool operator==(const char* o) const { return s_ == (o ? o : ""); }
  bool operator!=(const String& o) const { return !(*this == o); }
  bool operator!=(const char* o) const { return !(*this == o); }
  bool operator<(const String& o) const { return s_ < o.s_; }
  int indexOf(char c, unsigned from = 0) const { auto p = s_.find(c, from); return p == std::string::npos ? -1 : (int)p; }
  int indexOf(const char* t, unsigned from = 0) const { auto p = s_.find(t, from); return p == std::string::npos ? -1 : (int)p; }
  String substring(unsigned a) const { return a < s_.size() ? String(s_.substr(a)) : String(); }
  String substring(unsigned a, unsigned b) const { return a < s_.size() && b > a ? String(s_.substr(a, b - a)) : String(); }
  bool startsWith(const char* p) const { return s_.rfind(p, 0) == 0; }
  long toInt() const { return strtol(s_.c_str(), nullptr, 10); }
  float toFloat() const { return strtof(s_.c_str(), nullptr); }
  void trim() { const char* ws = " \t\r\n"; s_.erase(0, s_.find_first_not_of(ws)); s_.erase(s_.find_last_not_of(ws) + 1); }
  const std::string& std() const { return s_; }
  friend String operator+(const String& a, const String& b) { return String(a.s_ + b.s_); }
  friend String operator+(const String& a, const char* b) { return String(a.s_ + (b ? b : "")); }
  friend String operator+(const char* a, const String& b) { return String(std::string(a ? a : "") + b.s_); }
private:
  std::string s_;
};

// ─── Serial: stdout for printing, a background stdin reader for commands ─────
class SerialPort {
public:
  void begin(unsigned long) {}
  void setTxBufferSize(size_t) {}
  int  printf(const char* fmt, ...) __attribute__((format(printf, 2, 3)));
  size_t print(const char* s);
  size_t print(const String& s) { return print(s.c_str()); }
  size_t print(int v)      { return printf("%d", v); }
  size_t print(unsigned v) { return printf("%u", v); }
  size_t print(long v)     { return printf("%ld", v); }
  size_t print(float v, int d = 2)  { return printf("%.*f", d, v); }
  size_t print(double v, int d = 2) { return printf("%.*f", d, v); }
  size_t println() { return print("\n"); }
  template <typename T> size_t println(const T& v) { size_t n = print(v); return n + print("\n"); }
  size_t println(float v, int d)  { size_t n = print(v, d); return n + print("\n"); }
  size_t write(const uint8_t* b, size_t n);
  size_t write(uint8_t c) { return write(&c, 1); }
  int  available();
  int  read();
  void flush() { fflush(stdout); }
  explicit operator bool() const { return true; }
};
extern SerialPort Serial;

// ─── ESP object (memory stats only) ──────────────────────────────────────────
struct EspClass {
  uint32_t getFreeHeap()  const { return 256u * 1024u * 1024u; }
  uint32_t getFreePsram() const { return 256u * 1024u * 1024u; }
  uint32_t getPsramSize() const { return 256u * 1024u * 1024u; }
  void restart();
};
extern EspClass ESP;

// ─── FreeRTOS: tasks become threads, semaphores become mutex+condvar ─────────
typedef int      BaseType_t;
typedef unsigned UBaseType_t;
typedef uint32_t TickType_t;
#define pdFALSE 0
#define pdTRUE  1
#define pdFAIL  0
#define pdPASS  1
#define portMAX_DELAY 0xFFFFFFFFu
#define portTICK_PERIOD_MS 1
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))

struct RtosSemaphore;
typedef RtosSemaphore* SemaphoreHandle_t;
SemaphoreHandle_t xSemaphoreCreateBinary();
SemaphoreHandle_t xSemaphoreCreateMutex();
BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t ticks);
BaseType_t xSemaphoreGive(SemaphoreHandle_t s);
void vSemaphoreDelete(SemaphoreHandle_t s);
static inline BaseType_t xSemaphoreGiveFromISR(SemaphoreHandle_t s, BaseType_t* woken) { if (woken) *woken = pdFALSE; return xSemaphoreGive(s); }

typedef void* TaskHandle_t;
typedef void (*TaskFunction_t)(void*);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char* name, uint32_t stack, void* arg,
                                   UBaseType_t prio, TaskHandle_t* handle, BaseType_t core);
static inline BaseType_t xTaskCreate(TaskFunction_t fn, const char* name, uint32_t stack, void* arg,
                                     UBaseType_t prio, TaskHandle_t* handle) {
  return xTaskCreatePinnedToCore(fn, name, stack, arg, prio, handle, -1);
}
void vTaskDelay(TickType_t ticks);
void vTaskDelete(TaskHandle_t h);             // nullptr: end the calling task
static inline UBaseType_t uxTaskGetStackHighWaterMark(TaskHandle_t) { return 0; }
static inline BaseType_t xPortGetCoreID() { return 0; }

// portMUX critical sections → a plain mutex
struct portMUX_TYPE { void* impl = nullptr; };
#define portMUX_INITIALIZER_UNLOCKED {}
void portENTER_CRITICAL(portMUX_TYPE* m);
void portEXIT_CRITICAL(portMUX_TYPE* m);

// ─── Where the game keeps its save files (settings, championship, careers) ───
const char* rtDataDir();

// The OS keeps the clock and the time zone: nothing to set up.
static inline void configTime(long, int, const char*, const char* = nullptr, const char* = nullptr) {}
