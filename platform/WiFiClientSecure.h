#pragma once
// Only carries settings to HTTPClient: libcurl does the TLS, and checks
// certificates against the system's CA store unless setInsecure() was called.
#include "Arduino.h"
class WiFiClientSecure {
public:
  void setInsecure() { insecure = true; }
  void setCACert(const char*) {}
  void setTimeout(uint32_t t) { timeout = t; }
  void setHandshakeTimeout(uint32_t) {}
  int  lastError(char* buf, size_t n) { if (buf && n) buf[0] = 0; return 0; }
  void stop() {}
  bool insecure = false;
  uint32_t timeout = 0;
};
typedef WiFiClientSecure NetworkClientSecure;
