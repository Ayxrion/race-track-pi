#pragma once
// HTTPClient → libcurl (blocking, which is what the weather and telemetry
// tasks expect: each runs on its own thread).
#include "Arduino.h"
#include "WiFiClientSecure.h"
#include <vector>

#define HTTP_CODE_OK 200
#define HTTPC_ERROR_CONNECTION_REFUSED (-1)

class HTTPClient {
public:
  HTTPClient();
  ~HTTPClient();
  bool begin(WiFiClientSecure& client, const char* url);
  bool begin(WiFiClientSecure& client, const String& url) { return begin(client, url.c_str()); }
  bool begin(const char* url);
  void end();
  void setTimeout(uint32_t ms) { timeoutMs_ = ms; }
  void setConnectTimeout(int32_t ms) { connectMs_ = ms; }
  void setReuse(bool) {}
  void useHTTP10(bool) {}
  void setUserAgent(const String& ua) { addHeader("User-Agent", ua); }
  void addHeader(const String& name, const String& value);
  void collectHeaders(const char**, size_t) {}
  String header(const char*) { return String(); }
  int GET();
  int POST(const uint8_t* body, size_t n);
  int POST(const String& body) { return POST((const uint8_t*)body.c_str(), body.length()); }
  String getString() { return String(body_); }
  int getSize() const { return (int)body_.size(); }
private:
  int perform(bool post, const uint8_t* body, size_t n);
  void* curl_ = nullptr;
  std::string url_, body_;
  std::vector<std::string> headers_;
  bool insecure_ = false;
  uint32_t timeoutMs_ = 5000;
  int32_t connectMs_ = 5000;
};
