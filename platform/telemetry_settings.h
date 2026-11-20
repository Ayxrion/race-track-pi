#pragma once
// Runtime-only publisher credentials. Never bake a publishing key into a release.
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

namespace rtTelemetry {
struct Config {
  std::string url, token;
  const char* error = nullptr;
  bool enabled() const { return !error && !token.empty(); }
};

inline bool validToken(const std::string& token) {
  if (token.size() < 32 || token.size() >= 96) return false;
  for (unsigned char c : token) if (!std::isalnum(c) && c != '-' && c != '_') return false;
  return true;
}

inline bool validUrl(const std::string& url) {
  if (url.size() >= 128 || url.compare(0, 8, "https://") != 0) return false;
  const auto path = url.find('/', 8);
  if (path == std::string::npos || path == 8 || url.substr(path) != "/api/publish/pi") return false;
  for (unsigned char c : url) if (c <= 32 || c >= 127 || c == '@' || c == '\\' || c == '?' || c == '#') return false;
  return true;
}

inline Config load(const char* dataDir) {
  Config c;
  const char* url = std::getenv("RACE_TELEMETRY_URL");
  c.url = url ? url : "https://race.ayxie.com/api/publish/pi";
  const char* token = std::getenv("RACE_PI_PUBLISH_TOKEN");
  const char* file = std::getenv("RACE_PI_PUBLISH_TOKEN_FILE");
  if (token && file) { c.error = "set either RACE_PI_PUBLISH_TOKEN or RACE_PI_PUBLISH_TOKEN_FILE, not both"; return c; }
  if (token) c.token = token;
  else {
    const std::string path = file ? file : std::string(dataDir) + "/pi-publish-token.txt";
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) {
      if (file) c.error = "cannot read RACE_PI_PUBLISH_TOKEN_FILE";
      return c;
    }
    char bytes[128];
    const size_t size = std::fread(bytes, 1, sizeof(bytes), f);
    const bool failed = std::ferror(f) != 0;
    std::fclose(f);
    if (failed || size == sizeof(bytes)) { c.error = "cannot read publishing key (or file is too long)"; return c; }
    c.token.assign(bytes, size);
    // Accept a normal text file's trailing newline, including Windows CRLF.
    while (!c.token.empty() && (c.token.back() == '\r' || c.token.back() == '\n')) c.token.pop_back();
  }
  if (!validToken(c.token)) { c.error = "publishing key must be 32-95 letters, digits, hyphens or underscores"; return c; }
  if (!validUrl(c.url)) c.error = "relay URL must be HTTPS and end in /api/publish/pi";
  return c;
}
}
