#pragma once
// The operating system owns the network on a PC or a Pi: "WiFi" is always up.
#include "Arduino.h"
typedef enum { WL_IDLE_STATUS = 0, WL_NO_SSID_AVAIL = 1, WL_CONNECTED = 3, WL_CONNECT_FAILED = 4, WL_DISCONNECTED = 6 } wl_status_t;
typedef enum { WIFI_OFF = 0, WIFI_STA = 1, WIFI_AP = 2, WIFI_AP_STA = 3 } wifi_mode_t;
struct IPAddress { String toString() const { return String("(host network)"); } };
class WiFiClass {
public:
  wl_status_t status() const { return WL_CONNECTED; }
  bool mode(wifi_mode_t) { return true; }
  wifi_mode_t getMode() const { return WIFI_STA; }
  wl_status_t begin(const char*, const char* = nullptr) { return WL_CONNECTED; }
  bool disconnect(bool = false, bool = false) { return true; }
  int scanNetworks() { return 0; }
  String SSID(int = 0) const { return String(); }
  int32_t channel(int = 0) const { return 0; }
  int32_t RSSI(int = 0) const { return 0; }
  void scanDelete() {}
  IPAddress localIP() const { return IPAddress(); }
  void setSleep(bool) {}
  void setAutoReconnect(bool) {}
};
extern WiFiClass WiFi;
