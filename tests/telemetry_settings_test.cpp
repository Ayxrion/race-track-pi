#include "telemetry_settings.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <chrono>

#define CHECK(value) do { if (!(value)) { std::cerr << "Failed line " << __LINE__ << ": " #value "\n"; return 1; } } while (false)
static void env(const char* name, const char* value) {
#ifdef _WIN32
  _putenv_s(name, value ? value : "");
#else
  if (value) setenv(name, value, 1); else unsetenv(name);
#endif
}

int main() {
  namespace fs = std::filesystem;
  using namespace rtTelemetry;
  for (const char* key : {"RACE_TELEMETRY_URL", "RACE_PI_PUBLISH_TOKEN", "RACE_PI_PUBLISH_TOKEN_FILE"}) env(key, nullptr);
  const auto dir = fs::temp_directory_path() / ("race-telemetry-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  fs::create_directories(dir);
  struct Cleanup { fs::path dir; ~Cleanup() { fs::remove_all(dir); } } cleanup{dir};
  const std::string data = dir.string(), key(64, 'a');
  CHECK(!load(data.c_str()).enabled());
  CHECK(!load(data.c_str()).error);
  env("RACE_PI_PUBLISH_TOKEN_FILE", (dir / "missing.txt").string().c_str());
  CHECK(load(data.c_str()).error);
  env("RACE_PI_PUBLISH_TOKEN_FILE", nullptr);
  { std::ofstream f(dir / "pi-publish-token.txt", std::ios::binary); f << key << "\r\n"; }
  auto config = load(data.c_str());
  CHECK(config.enabled()); CHECK(config.token == key);
  CHECK(config.url == "https://race.ayxie.com/api/publish/pi");
  env("RACE_TELEMETRY_URL", "https://race.ayxie.com/api/publish");
  CHECK(load(data.c_str()).error); // A Pi must never publish into the ESP32 route.
  for (const char* url : {"http://race.ayxie.com/api/publish/pi", "https:///api/publish/pi", "https://user@host/api/publish/pi", "https://host/api/publish/pi?x=y", "https://host\r\n/api/publish/pi"}) CHECK(!validUrl(url));
  env("RACE_TELEMETRY_URL", "https://localhost:8787/api/publish/pi");
  CHECK(load(data.c_str()).enabled());
  env("RACE_PI_PUBLISH_TOKEN", "short"); CHECK(load(data.c_str()).error);
  env("RACE_PI_PUBLISH_TOKEN", key.c_str()); CHECK(load(data.c_str()).enabled());
  env("RACE_PI_PUBLISH_TOKEN_FILE", (dir / "pi-publish-token.txt").string().c_str());
  CHECK(load(data.c_str()).error); // Ambiguous credentials fail closed.
  env("RACE_PI_PUBLISH_TOKEN", nullptr);
  CHECK(load(data.c_str()).enabled());
  for (const std::string bad : {std::string(), std::string(128, 'a'), key + "\nInjected: header", std::string("\xef\xbb\xbf") + key}) {
    { std::ofstream f(dir / "pi-publish-token.txt", std::ios::binary); f << bad; }
    CHECK(load(data.c_str()).error);
  }
  std::cout << "Pi runtime settings passed\n";
}
