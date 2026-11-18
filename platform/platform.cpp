// Implementations behind platform/*.h: time, threads, semaphores, the serial
// console, save files and HTTP (libcurl).

#include "Arduino.h"
#include "Preferences.h"
#include "WiFi.h"
#include "HTTPClient.h"

#include <chrono>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <atomic>
#include <random>
#include <filesystem>
#include <fstream>
#include <curl/curl.h>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace fs = std::filesystem;

// ─── Time ─────────────────────────────────────────────────────────────────────
// Sleeps: Windows rounds ordinary sleeps up to its 15.6 ms tick (Windows 11 ignores
// timeBeginPeriod for covered windows), so use a high-resolution waitable timer there.
static void preciseSleepUs(uint64_t us) {
#ifdef _WIN32
  thread_local HANDLE timer = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (timer) {
    LARGE_INTEGER due; due.QuadPart = -(LONGLONG)(us * 10);   // relative, 100 ns units
    if (SetWaitableTimer(timer, &due, 0, nullptr, nullptr, FALSE)) { WaitForSingleObject(timer, INFINITE); return; }
  }
#endif
  std::this_thread::sleep_for(std::chrono::microseconds(us));
}

static const auto t0 = std::chrono::steady_clock::now();
uint32_t millis() { return (uint32_t)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count(); }
uint32_t micros() { return (uint32_t)std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - t0).count(); }
void delay(uint32_t ms) { preciseSleepUs((uint64_t)ms * 1000); }
void delayMicroseconds(uint32_t us) { preciseSleepUs(us); }

uint32_t esp_random() {
  static std::mutex m; static std::mt19937 g{ std::random_device{}() ^ (uint32_t)micros() };
  std::lock_guard<std::mutex> l(m); return g();
}

const char* esp_err_to_name(esp_err_t e) {
  switch (e) {
    case ESP_OK: return "ESP_OK";
    case ESP_FAIL: return "ESP_FAIL";
    case ESP_ERR_NO_MEM: return "ESP_ERR_NO_MEM";
    case ESP_ERR_INVALID_ARG: return "ESP_ERR_INVALID_ARG";
    case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
    case ESP_ERR_NOT_SUPPORTED: return "not on this platform";
    default: return "ESP_ERR";
  }
}

EspClass ESP;
void EspClass::restart() { fflush(stdout); std::exit(0); }
WiFiClass WiFi;

// ─── Serial ───────────────────────────────────────────────────────────────────
SerialPort Serial;
static std::mutex outMu;

int SerialPort::printf(const char* fmt, ...) {
  char stackBuf[512];
  va_list a; va_start(a, fmt);
  int n = vsnprintf(stackBuf, sizeof(stackBuf), fmt, a);
  va_end(a);
  if (n < 0) return 0;
  std::lock_guard<std::mutex> l(outMu);
  if ((size_t)n < sizeof(stackBuf)) fwrite(stackBuf, 1, n, stdout);
  else {
    std::string big(n + 1, '\0');
    va_start(a, fmt); vsnprintf(&big[0], big.size(), fmt, a); va_end(a);
    fwrite(big.data(), 1, n, stdout);
  }
  fflush(stdout);
  return n;
}
size_t SerialPort::print(const char* s) {
  std::lock_guard<std::mutex> l(outMu);
  size_t n = fwrite(s, 1, strlen(s), stdout); fflush(stdout); return n;
}
size_t SerialPort::write(const uint8_t* b, size_t n) {
  std::lock_guard<std::mutex> l(outMu);
  n = fwrite(b, 1, n, stdout); fflush(stdout); return n;
}

// Commands typed into the console (the same ones the ESP32 takes over USB).
static std::mutex inMu;
static std::deque<int> inQ;
static void stdinReader() {
  for (int c; (c = fgetc(stdin)) != EOF; ) { std::lock_guard<std::mutex> l(inMu); inQ.push_back(c); }
}
static void startStdin() {
  static std::once_flag once;
  std::call_once(once, [] { std::thread(stdinReader).detach(); });
}
int SerialPort::available() { startStdin(); std::lock_guard<std::mutex> l(inMu); return (int)inQ.size(); }
int SerialPort::read() {
  std::lock_guard<std::mutex> l(inMu);
  if (inQ.empty()) return -1;
  int c = inQ.front(); inQ.pop_front(); return c;
}

// ─── FreeRTOS stand-ins ───────────────────────────────────────────────────────
struct RtosSemaphore { std::mutex m; std::condition_variable cv; int count, max; };

SemaphoreHandle_t xSemaphoreCreateBinary() { auto* s = new RtosSemaphore; s->count = 0; s->max = 1; return s; }
SemaphoreHandle_t xSemaphoreCreateMutex()  { auto* s = new RtosSemaphore; s->count = 1; s->max = 1; return s; }

BaseType_t xSemaphoreTake(SemaphoreHandle_t s, TickType_t ticks) {
  if (!s) return pdFALSE;
  std::unique_lock<std::mutex> l(s->m);
  if (ticks == portMAX_DELAY) s->cv.wait(l, [s] { return s->count > 0; });
  else if (!s->cv.wait_for(l, std::chrono::milliseconds(ticks), [s] { return s->count > 0; })) return pdFALSE;
  --s->count;
  return pdTRUE;
}
BaseType_t xSemaphoreGive(SemaphoreHandle_t s) {
  if (!s) return pdFALSE;
  { std::lock_guard<std::mutex> l(s->m); if (s->count >= s->max) return pdFALSE; ++s->count; }
  s->cv.notify_one();
  return pdTRUE;
}

void vSemaphoreDelete(SemaphoreHandle_t s) { delete s; }

struct TaskExit {};   // thrown by vTaskDelete(nullptr) to unwind the task's thread
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t fn, const char*, uint32_t, void* arg, UBaseType_t, TaskHandle_t* handle, BaseType_t) {
  static int tokens[64]; static std::atomic<int> next{0};
  if (handle) *handle = &tokens[next++ & 63];
  std::thread([fn, arg] { try { fn(arg); } catch (const TaskExit&) {} }).detach();
  return pdPASS;
}
void vTaskDelay(TickType_t ticks) { preciseSleepUs((uint64_t)(ticks ? ticks : 1) * 1000); }
void vTaskDelete(TaskHandle_t h) { if (!h) throw TaskExit(); }

static std::recursive_mutex critMu;
void portENTER_CRITICAL(portMUX_TYPE*) { critMu.lock(); }
void portEXIT_CRITICAL(portMUX_TYPE*)  { critMu.unlock(); }

// ─── Save files ───────────────────────────────────────────────────────────────
const char* rtDataDir() {
  static std::string dir;
  static std::once_flag once;
  std::call_once(once, [] {
    const char* e = getenv("RACE_TRACK_DATA");
    dir = (e && *e) ? e : "data";
    std::error_code ec; fs::create_directories(dir, ec);
  });
  return dir.c_str();
}

static std::mutex prefsMu;

bool Preferences::begin(const char* ns, bool readOnly) {
  std::lock_guard<std::mutex> l(prefsMu);
  ns_ = ns; ro_ = readOnly; dirty_ = false; kv_.clear();
  path_ = std::string(rtDataDir()) + "/" + ns_ + ".prefs";
  std::ifstream f(path_, std::ios::binary);
  char magic[4];
  if (f.read(magic, 4) && !memcmp(magic, "RTP1", 4)) {
    for (;;) {
      uint16_t kl; uint32_t vl;
      if (!f.read((char*)&kl, 2)) break;
      std::string k(kl, '\0');
      if (!f.read(&k[0], kl) || !f.read((char*)&vl, 4) || vl > (64u << 20)) break;
      std::vector<uint8_t> v(vl);
      if (vl && !f.read((char*)v.data(), vl)) break;
      kv_[k] = std::move(v);
    }
  }
  open_ = true;
  return true;
}

void Preferences::end() {
  std::lock_guard<std::mutex> l(prefsMu);
  if (open_ && !ro_ && dirty_) {
    const std::string tmp = path_ + ".tmp";
    {
      std::ofstream f(tmp, std::ios::binary | std::ios::trunc);
      f.write("RTP1", 4);
      for (auto& [k, v] : kv_) {
        uint16_t kl = (uint16_t)k.size(); uint32_t vl = (uint32_t)v.size();
        f.write((const char*)&kl, 2); f.write(k.data(), kl);
        f.write((const char*)&vl, 4); if (vl) f.write((const char*)v.data(), vl);
      }
    }
    std::error_code ec; fs::rename(tmp, path_, ec);
    if (ec) Serial.printf("Preferences: could not save %s (%s)\n", path_.c_str(), ec.message().c_str());
  }
  open_ = false; dirty_ = false;
}

bool Preferences::clear() { if (!open_ || ro_) return false; kv_.clear(); dirty_ = true; return true; }
bool Preferences::remove(const char* key) { if (!open_ || ro_) return false; dirty_ |= kv_.erase(key) > 0; return true; }

size_t Preferences::putBytes(const char* key, const void* v, size_t n) {
  if (!open_ || ro_) return 0;
  std::vector<uint8_t> b((const uint8_t*)v, (const uint8_t*)v + n);
  auto it = kv_.find(key);
  if (it == kv_.end() || it->second != b) { kv_[key] = std::move(b); dirty_ = true; }
  return n;
}
size_t Preferences::getBytesLength(const char* key) const { auto it = kv_.find(key); return it == kv_.end() ? 0 : it->second.size(); }
size_t Preferences::getBytes(const char* key, void* buf, size_t n) const {
  auto it = kv_.find(key);
  if (it == kv_.end() || it->second.size() > n) return 0;
  memcpy(buf, it->second.data(), it->second.size());
  return it->second.size();
}
String Preferences::getString(const char* k, const String& d) const {
  auto it = kv_.find(k);
  return it == kv_.end() ? d : String(std::string(it->second.begin(), it->second.end()));
}
size_t Preferences::getString(const char* k, char* buf, size_t n) const {
  auto it = kv_.find(k);
  if (it == kv_.end() || it->second.size() + 1 > n) return 0;
  memcpy(buf, it->second.data(), it->second.size()); buf[it->second.size()] = 0;
  return it->second.size() + 1;
}

// ─── HTTP (libcurl) ───────────────────────────────────────────────────────────
static size_t curlWrite(char* p, size_t sz, size_t n, void* ud) { ((std::string*)ud)->append(p, sz * n); return sz * n; }

HTTPClient::HTTPClient() { static std::once_flag once; std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); }); }
HTTPClient::~HTTPClient() { end(); }

bool HTTPClient::begin(WiFiClientSecure& client, const char* url) {
  insecure_ = client.insecure;
  if (client.timeout) timeoutMs_ = client.timeout < 1000 ? client.timeout * 1000 : client.timeout;   // ESP32 code passes seconds or ms
  return begin(url);
}
bool HTTPClient::begin(const char* url) {
  if (!curl_) curl_ = curl_easy_init();
  url_ = url ? url : "";
  headers_.clear();
  return curl_ && !url_.empty();
}
void HTTPClient::end() { if (curl_) { curl_easy_cleanup((CURL*)curl_); curl_ = nullptr; } }
void HTTPClient::addHeader(const String& name, const String& value) { headers_.push_back(std::string(name.c_str()) + ": " + value.c_str()); }

int HTTPClient::GET() { return perform(false, nullptr, 0); }
int HTTPClient::POST(const uint8_t* body, size_t n) { return perform(true, body, n); }

int HTTPClient::perform(bool post, const uint8_t* body, size_t n) {
  if (!curl_) return HTTPC_ERROR_CONNECTION_REFUSED;
  CURL* c = (CURL*)curl_;
  body_.clear();
  curl_easy_setopt(c, CURLOPT_URL, url_.c_str());
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, curlWrite);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &body_);
  curl_easy_setopt(c, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, (long)timeoutMs_ + (long)connectMs_);
  curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT_MS, (long)connectMs_);
  curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, insecure_ ? 0L : 1L);
  curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, insecure_ ? 0L : 2L);
#ifdef _WIN32
  curl_easy_setopt(c, CURLOPT_SSL_OPTIONS, (long)CURLSSLOPT_NATIVE_CA);   // the Windows certificate store
#endif
  curl_slist* hl = nullptr;
  for (auto& h : headers_) hl = curl_slist_append(hl, h.c_str());
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, hl);
  if (post) {
    curl_easy_setopt(c, CURLOPT_POST, 1L);
    curl_easy_setopt(c, CURLOPT_POSTFIELDS, (const char*)body);
    curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, (long)n);
  } else {
    curl_easy_setopt(c, CURLOPT_HTTPGET, 1L);
  }
  CURLcode r = curl_easy_perform(c);
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, nullptr);
  curl_slist_free_all(hl);
  if (r != CURLE_OK) return -1;
  long code = 0;
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
  return (int)code;
}

