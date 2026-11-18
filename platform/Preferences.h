#pragma once
// Preferences (ESP32 NVS) → one small file per namespace in the data folder
// (rtDataDir(): $RACE_TRACK_DATA, or ./data). Written on end() when changed,
// through a temporary file so a power cut can't leave a half-written save.
#include "Arduino.h"
#include <map>
#include <vector>

class Preferences {
public:
  bool begin(const char* ns, bool readOnly = false);
  void end();
  bool clear();
  bool remove(const char* key);
  bool isKey(const char* key) const { return kv_.count(key) > 0; }

  size_t putBytes(const char* key, const void* v, size_t n);
  size_t getBytesLength(const char* key) const;
  size_t getBytes(const char* key, void* buf, size_t n) const;

  size_t putUChar(const char* k, uint8_t v)  { return putT(k, v); }
  size_t putChar(const char* k, int8_t v)    { return putT(k, v); }
  size_t putBool(const char* k, bool v)      { return putT(k, (uint8_t)v); }
  size_t putUShort(const char* k, uint16_t v){ return putT(k, v); }
  size_t putShort(const char* k, int16_t v)  { return putT(k, v); }
  size_t putUInt(const char* k, uint32_t v)  { return putT(k, v); }
  size_t putInt(const char* k, int32_t v)    { return putT(k, v); }
  size_t putULong(const char* k, uint32_t v) { return putT(k, v); }
  size_t putLong(const char* k, int32_t v)   { return putT(k, v); }
  size_t putFloat(const char* k, float v)    { return putT(k, v); }
  uint8_t  getUChar(const char* k, uint8_t d = 0) const  { return getT(k, d); }
  int8_t   getChar(const char* k, int8_t d = 0) const    { return getT(k, d); }
  bool     getBool(const char* k, bool d = false) const  { return getT<uint8_t>(k, d) != 0; }
  uint16_t getUShort(const char* k, uint16_t d = 0) const{ return getT(k, d); }
  int16_t  getShort(const char* k, int16_t d = 0) const  { return getT(k, d); }
  uint32_t getUInt(const char* k, uint32_t d = 0) const  { return getT(k, d); }
  int32_t  getInt(const char* k, int32_t d = 0) const    { return getT(k, d); }
  uint32_t getULong(const char* k, uint32_t d = 0) const { return getT(k, d); }
  int32_t  getLong(const char* k, int32_t d = 0) const   { return getT(k, d); }
  float    getFloat(const char* k, float d = 0) const    { return getT(k, d); }

  size_t putString(const char* k, const char* v) { return putBytes(k, v, strlen(v)) ? strlen(v) : 0; }
  size_t putString(const char* k, const String& v) { return putString(k, v.c_str()); }
  String getString(const char* k, const String& d = String()) const;
  size_t getString(const char* k, char* buf, size_t n) const;

private:
  template <typename T> size_t putT(const char* k, T v) { return putBytes(k, &v, sizeof(v)); }
  template <typename T> T getT(const char* k, T d) const {
    auto it = kv_.find(k);
    if (it == kv_.end() || it->second.size() != sizeof(T)) return d;
    T v; memcpy(&v, it->second.data(), sizeof(T)); return v;
  }
  std::string ns_, path_;
  std::map<std::string, std::vector<uint8_t>> kv_;
  bool open_ = false, ro_ = true, dirty_ = false;
};
