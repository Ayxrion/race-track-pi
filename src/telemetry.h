#pragma once
// Read-only internet telemetry for the 3D companion (a separate web viewer).
// Compiled into every build, but idle unless the relay URL and publishing token
// are stored in NVS. Release binaries are public, so they never contain the
// token: a local telemetry_config.h (gitignored) seeds NVS on a USB-flashed
// build, and the stored values then survive OTA updates. `telemetry off` on
// the serial port clears them.
// Called only on core 1 with the simulation idle. Network I/O owns copies and
// never reads cars[], tp[], trk, or any other mutable simulation state.
#if __has_include("telemetry_config.h")
#include "telemetry_config.h"
#endif
#include <stdarg.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <mbedtls/platform.h>
#include "telemetry_ca.h"

#ifndef RT_TELEMETRY_INTERVAL_MS
#define RT_TELEMETRY_INTERVAL_MS 100
#endif
#define RT_TELEMETRY_NS "telemetry"

static char telemetryUrl[128]={};
static char telemetryToken[96]={};

static bool telemetryValid(const char* url,const char* token) {
  return !strncmp(url,"https://",8)&&strlen(url)<sizeof(telemetryUrl)&&strlen(token)>=32&&strlen(token)<sizeof(telemetryToken);
}

// Loads the relay settings, seeding NVS from a local telemetry_config.h if present.
static bool telemetryLoadConfig() {
  Preferences p;p.begin(RT_TELEMETRY_NS,false);
#if defined(RT_TELEMETRY_ENABLED) && RT_TELEMETRY_ENABLED && defined(RT_TELEMETRY_URL) && defined(RT_TELEMETRY_TOKEN)
  if(telemetryValid(RT_TELEMETRY_URL,RT_TELEMETRY_TOKEN)&&(p.getString("url")!=RT_TELEMETRY_URL||p.getString("token")!=RT_TELEMETRY_TOKEN)){
    p.putString("url",RT_TELEMETRY_URL);p.putString("token",RT_TELEMETRY_TOKEN);
    Serial.println("Telemetry: relay settings saved from telemetry_config.h");
  }
#endif
  if(p.isKey("url"))p.getString("url",telemetryUrl,sizeof(telemetryUrl));
  if(p.isKey("token"))p.getString("token",telemetryToken,sizeof(telemetryToken));
  p.end();
  return telemetryValid(telemetryUrl,telemetryToken);
}

static void telemetryForget() {
  Preferences p;p.begin(RT_TELEMETRY_NS,false);p.clear();p.end();
  Serial.println("Telemetry: relay settings cleared; the feed stops after a reboot");
}

static constexpr size_t RT_MANIFEST_CAP = 300000;
static constexpr size_t RT_FRAME_CAP = 12000;
struct TelemetryCar {
  float x,y,h,v,dmg,gap; int lap,pit; bool out,brake,wets,finished;
};
struct TelemetryFrame {
  uint32_t race,seq; float t,night,wet; int phase,lap,laps,n,orderN,weather;
  char series[24],event[120]; int order[MAX_CARS]; TelemetryCar cars[MAX_CARS+1];
};
static SemaphoreHandle_t telemetryLock=nullptr;
static char* telemetryManifest=nullptr;
static size_t telemetryManifestLen=0;
static TelemetryFrame telemetryLatest={};
static uint32_t telemetryRaceId=0,telemetrySeq=0,telemetryLastCapture=0;
static char telemetrySession[20]={};
static bool telemetryReady=false;

// Arduino's prebuilt TLS library allocates both 16 KB record buffers internally.
// Keep large TLS allocations in PSRAM so telemetry and weather can coexist.
// Small allocations retain the SDK's internal-memory policy. heap_caps_free
// handles both memory regions, including allocations made before this hook.
static void* telemetryTLSCalloc(size_t count,size_t size) {
  if(size&&count>SIZE_MAX/size)return nullptr;
  if(count*size>=4096){
    void* p=heap_caps_calloc(count,size,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(p)return p;
  }
  // Preserve the internal-memory policy of the supported Arduino 3.3.0 SDK.
  return heap_caps_calloc(count,size,MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);
}

// Fixed-capacity writer: no dynamic String/JSON allocation on the render loop.
struct TelemetryWriter {
  char* buf; size_t cap,n=0; bool ok=true;
  void add(const char* fmt,...) {
    if(!ok)return;va_list args;va_start(args,fmt);
    int count=vsnprintf(buf+n,cap-n,fmt,args);va_end(args);
    if(count<0||(size_t)count>=cap-n){ok=false;return;}n+=(size_t)count;
  }
  void string(const char* s) {
    add("\"");for(;*s&&ok;++s){const unsigned char c=(unsigned char)*s;
      if(c=='"'||c=='\\')add("\\%c",c);else if(c<32)add("\\u%04x",c);else add("%c",c);
    }add("\"");
  }
};

static void telemetryTask(void*) {
  char* tx=(char*)heap_caps_malloc(RT_MANIFEST_CAP,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  char* frameBuf=(char*)heap_caps_malloc(RT_FRAME_CAP,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  if(!tx||!frameBuf){Serial.println("Telemetry: transmit buffer allocation failed");free(tx);free(frameBuf);vTaskDelete(nullptr);return;}
  WiFiClientSecure secure;
  // Certificate verification is mandatory; never fall back to setInsecure().
  secure.setCACert(RT_TELEMETRY_CA_BUNDLE);secure.setTimeout(2000);secure.setHandshakeTimeout(8);
  HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(2000);http.setReuse(true);
  uint32_t sentRace=0,sentSeq=0,backoff=1000;bool begun=false;
  for(;;){
    if(WiFi.status()!=WL_CONNECTED||!timeSynced()){
      if(begun){http.end();begun=false;}sentRace=0;
      vTaskDelay(pdMS_TO_TICKS(1000));continue;
    }
    TelemetryFrame f;size_t manifestLen=0;bool ready=false;
    xSemaphoreTake(telemetryLock,portMAX_DELAY);
    ready=telemetryReady&&telemetryManifestLen>0&&telemetryLatest.race==telemetryRaceId;
    if(ready){f=telemetryLatest;if(sentRace!=f.race){manifestLen=telemetryManifestLen;memcpy(tx,telemetryManifest,manifestLen);}}
    xSemaphoreGive(telemetryLock);
    if(!ready){vTaskDelay(pdMS_TO_TICKS(50));continue;}
    if(!manifestLen&&f.seq==sentSeq){vTaskDelay(pdMS_TO_TICKS(10));continue;}
    if(!begun){
      begun=http.begin(secure,telemetryUrl);
      if(!begun){vTaskDelay(pdMS_TO_TICKS(5000));continue;}
      http.addHeader("Authorization",String("Bearer ")+telemetryToken);
      http.addHeader("Content-Type","application/json");
    }
    char* body=tx;size_t bodyLen=manifestLen;
    if(!manifestLen){
      TelemetryWriter w{frameBuf,RT_FRAME_CAP};
      w.add("{\"v\":1,\"type\":\"frame\",\"session\":\"%s\",\"race\":%u,\"seq\":%u,\"t\":%.3f,\"phase\":%d,\"lap\":%d,\"laps\":%d,\"weather\":%d,\"night\":%.3f,\"wet\":%.3f,\"series\":",telemetrySession,f.race,f.seq,f.t,f.phase,f.lap,f.laps,f.weather,f.night,f.wet);
      w.string(f.series);w.add(",\"event\":");w.string(f.event);w.add(",\"order\":[");
      for(int i=0;i<f.orderN;i++)w.add("%s%d",i?",":"",f.order[i]);w.add("],\"cars\":[");
      for(int i=0;i<f.n;i++){const TelemetryCar& c=f.cars[i];w.add("%s[%d,%.2f,%.2f,%.4f,%.2f,%d,%d,%s,%s,%.3f,%s,%s,%.2f]",i?",":"",i,c.x,c.y,c.h,c.v,c.lap,c.pit,c.out?"true":"false",c.brake?"true":"false",c.dmg,c.wets?"true":"false",c.finished?"true":"false",c.gap);}
      w.add("]}");if(!w.ok){vTaskDelay(pdMS_TO_TICKS(1000));continue;}body=frameBuf;bodyLen=w.n;
    }
    const int code=http.POST((uint8_t*)body,bodyLen);
    // Drain the small response before reusing the HTTP/TLS connection.
    if(code>0)http.getString();
    if(code==200){if(manifestLen)sentRace=f.race;else sentSeq=f.seq;backoff=1000;vTaskDelay(pdMS_TO_TICKS(45));}
    else{
      // Includes relay restart (409): resend the manifest on the next connection.
      Serial.printf("Telemetry: publish status %d, retry in %u ms\n",code,backoff);
      if(code<0){char tlsError[160]={};const int tlsCode=secure.lastError(tlsError,sizeof(tlsError));Serial.printf("Telemetry: TLS %d (%s), heap %u, largest %u, task spare %u\n",tlsCode,tlsError,ESP.getFreeHeap(),heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),(unsigned)uxTaskGetStackHighWaterMark(nullptr));}
      http.end();begun=false;sentRace=0;vTaskDelay(pdMS_TO_TICKS(backoff));backoff=backoff<15000?backoff*2:30000;
    }
  }
}

static void telemetryInit() {
  if(!telemetryLoadConfig()){Serial.println("Telemetry: off (no relay configured)");return;}
  Serial.printf("Telemetry: publishing to %.*s\n",(int)strcspn(telemetryUrl+8,"/")+8,telemetryUrl);
  // Install before starting the weather/telemetry networking tasks.
  if(mbedtls_platform_set_calloc_free(telemetryTLSCalloc,heap_caps_free)!=0){Serial.println("Telemetry: TLS allocator setup failed");return;}
  telemetryManifest=(char*)heap_caps_malloc(RT_MANIFEST_CAP,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
  telemetryLock=xSemaphoreCreateMutex();
  if(!telemetryManifest||!telemetryLock){Serial.println("Telemetry: initialization allocation failed");return;}
  snprintf(telemetrySession,sizeof(telemetrySession),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
  telemetryReady=true;
  if(xTaskCreatePinnedToCore(telemetryTask,"telemetry",12288,nullptr,1,nullptr,0)!=pdPASS){telemetryReady=false;Serial.println("Telemetry: task creation failed");return;}
}

// Called after world generation and startRace, before the simulation resumes.
static void telemetryNewRace() {
  if(!telemetryReady)return;
  xSemaphoreTake(telemetryLock,portMAX_DELAY);
  ++telemetryRaceId;telemetrySeq=0;telemetryLatest.race=0;telemetryManifestLen=0;
  TelemetryWriter w{telemetryManifest,RT_MANIFEST_CAP};
  w.add("{\"v\":1,\"type\":\"manifest\",\"session\":\"%s\",\"race\":%u,\"track\":{\"name\":",telemetrySession,telemetryRaceId);w.string(trk.name);
  w.add(",\"width\":%.3f,\"L\":%.3f,\"ds\":%.6f,\"points\":[",trk.W,trk.L,trk.ds);
  for(int i=0;i<trk.n;i++){const TrackPt& p=tp[i];w.add("%s[%.2f,%.2f,%.5f,%.5f,%.2f,%.2f,%u,%u,%u,%u]",i?",":"",p.x,p.y,p.tx,p.ty,p.bar[0],p.bar[1],p.kerb[0],p.kerb[1],p.run[0],p.run[1]);}
  w.add("],\"stands\":[");
  for(int i=0;i<trk.nStands;i++){const Stand& s=trk.stands[i];w.add("%s{\"sc\":%.3f,\"half\":%.3f,\"d0\":%.3f,\"d1\":%.3f,\"side\":%d,\"roofHue\":%u}",i?",":"",s.sc,s.half,s.d0,s.d1,s.side,s.roofHue);}
  w.add("],\"pits\":{\"has\":%s,\"side\":%d,\"s0\":%.3f,\"s1\":%.3f},\"lights\":[",trk.hasPits?"true":"false",trk.pitSide,trk.pitS0,trk.pitS1);
  for(int i=0;i<trk.nLights;i++)w.add("%s[%d,%d]",i?",":"",trk.lights[i].x,trk.lights[i].y);
  w.add("]},\"roster\":[");
  // Include the safety car's stable slot even when it isn't currently visible.
  for(int i=0;i<=numCars;i++){const Car& c=cars[i];const bool safety=i==numCars;const ClassSpec& spec=CLS[safety?CC_GT:c.cls];
    w.add("%s{\"id\":%d,\"code\":",i?",":"",i);w.string(safety?"SC":c.code);
    w.add(",\"num\":%u,\"cls\":%u,\"len\":%.2f,\"wid\":%.2f,\"colors\":[%u,%u,%u],\"safety\":%s}",safety?0:c.num,safety?(unsigned)CC_GT:(unsigned)c.cls,spec.len,spec.wid,safety?0xe6e6e6u:c.c1,safety?0x222222u:c.c2,safety?0xffa500u:c.c3,safety?"true":"false");
  }
  w.add("]}");if(w.ok)telemetryManifestLen=w.n;else Serial.println("Telemetry: circuit message exceeded buffer; feed disabled for this race");
  xSemaphoreGive(telemetryLock);
}

static void telemetryCapture() {
  if(!telemetryReady)return;const uint32_t now=millis();
  if(now-telemetryLastCapture<RT_TELEMETRY_INTERVAL_MS)return;
  // Skip a snapshot if the worker is copying; never wait in the rendering path.
  if(xSemaphoreTake(telemetryLock,0)!=pdTRUE)return;
  telemetryLastCapture=now;TelemetryFrame& f=telemetryLatest;
  f.race=telemetryRaceId;f.seq=++telemetrySeq;f.t=simTime;f.phase=(int)phase;f.lap=leaderLapDisplay();f.laps=raceLaps;
  f.n=numDraw();f.orderN=numCars;f.weather=(int)effectiveWeather();f.night=nightAmt;f.wet=wetAmt;
  snprintf(f.series,sizeof(f.series),"%s",SERIES_NAMES[raceSeries]);
  snprintf(f.event,sizeof(f.event),"%s",(int32_t)(evUntil-now)>0?evMsg:"");
  memcpy(f.order,order,sizeof(int)*numCars);
  for(int i=0;i<f.n;i++){const Car& c=cars[i];f.cars[i]={c.x,c.y,c.heading+c.slip,c.v,c.dmg,i<numCars?gapToLeader(i):0.0f,c.lap,c.pit,c.out,c.braking,c.wets,c.finished};}
  xSemaphoreGive(telemetryLock);
}
