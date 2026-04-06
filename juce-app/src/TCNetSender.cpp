#include "TCNetSender.h"
#include <cstring>
#include <cmath>

namespace TCNet
{

// ── helpers ──────────────────────────────────
static void writeU16LE(uint8_t* p, uint16_t v) { p[0] = v & 0xFF; p[1] = (v >> 8) & 0xFF; }
static void writeU32LE(uint8_t* p, uint32_t v) { p[0]=v&0xFF; p[1]=(v>>8)&0xFF; p[2]=(v>>16)&0xFF; p[3]=(v>>24)&0xFF; }
// static void writeU32BE(uint8_t* p, uint32_t v) { p[0]=(v>>24)&0xFF; p[1]=(v>>16)&0xFF; p[2]=(v>>8)&0xFF; p[3]=v&0xFF; }

static void writeString(uint8_t* p, const juce::String& s, int maxLen)
{
    auto utf8 = s.toUTF8();
    size_t len = (size_t)juce::jmin((int)std::strlen(utf8), maxLen - 1);
    std::memcpy(p, utf8, len);
}

static uint32_t timestampUs()
{
    auto now = juce::Time::getHighResolutionTicks();
    double sec = juce::Time::highResolutionTicksToSeconds(now);
    return (uint32_t)((uint64_t)(sec * 1e6) & 0xFFFFFFFF);
}

// ── header ───────────────────────────────────
void buildHeader(uint8_t* out, uint8_t type, NodeIdentity& id)
{
    std::memset(out, 0, HDR_SIZE);
    out[0] = id.nodeId[0];
    out[1] = id.nodeId[1];
    out[2] = 0x03; out[3] = 0x05;        // version 3.5
    out[4] = 'T'; out[5] = 'C'; out[6] = 'N';  // magic
    out[7] = type;
    // node name (8 bytes padded)
    std::memcpy(out + 8, id.nodeName, juce::jmin(8, (int)std::strlen(id.nodeName)));
    out[16] = id.seq++;
    out[17] = id.nodeType;
    out[18] = 0x07; out[19] = 0x00;       // node options
    writeU32LE(out + 20, timestampUs());
}

// ── OptIn (68B) ──────────────────────────────
void buildOptIn(uint8_t* out, NodeIdentity& id, int listenerPort, int uptimeSec, int nodeCount)
{
    std::memset(out, 0, SZ_OPTIN);
    buildHeader(out, TYPE_OPTIN, id);
    uint8_t* d = out + HDR_SIZE;

    writeU16LE(d + 0, (uint16_t)nodeCount);
    writeU16LE(d + 2, (uint16_t)listenerPort);
    writeU16LE(d + 4, (uint16_t)uptimeSec);
    writeString(d + 8,  "PIONEER DJ CORP", 16);
    writeString(d + 24, "PRODJLINK BRIDGE", 16);
    d[40] = 1; d[41] = 1; d[42] = 67;   // app version 1.1.67
}

// ── OptOut (28B) ─────────────────────────────
void buildOptOut(uint8_t* out, NodeIdentity& id, int listenerPort)
{
    std::memset(out, 0, SZ_OPTOUT);
    buildHeader(out, TYPE_OPTOUT, id);
    uint8_t* d = out + HDR_SIZE;
    writeU16LE(d + 0, 2);                   // nodeCount
    writeU16LE(d + 2, (uint16_t)listenerPort);
}

// ── Status (300B) ────────────────────────────
void buildStatus(uint8_t* out, NodeIdentity& id, int listenerPort,
                 const std::array<LayerState*, 8>& layers,
                 const std::array<bool, 8>& hwMode)
{
    std::memset(out, 0, SZ_STATUS);
    buildHeader(out, TYPE_STATUS, id);
    uint8_t* d = out + HDR_SIZE;  // body 276B

    int nc = 0;
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n] || hwMode[(size_t)n]) nc++;

    writeU16LE(d + 0, (uint16_t)juce::jmax(1, nc));
    writeU16LE(d + 2, (uint16_t)listenerPort);

    // layerSource[0-7] at body[10-17]
    for (int n = 0; n < 8; n++)
        d[10 + n] = (layers[(size_t)n] || hwMode[(size_t)n]) ? (uint8_t)(n + 1) : 0;

    // layerStatus[0-7] at body[18-25]
    for (int n = 0; n < 8; n++)
        d[18 + n] = layers[(size_t)n] ? toTCNetState(layers[(size_t)n]->state) : 0;

    // trackID[0-7] at body[26-57] (LE u32)
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n])
            writeU32LE(d + 26 + n * 4, (uint32_t)layers[(size_t)n]->trackId);

    d[59] = 0x1E;  // smpteMode = 30fps
    d[60] = 0x00;  // autoMasterMode

    // device name at body[96-111]
    writeString(d + 96, "PRODJLINK BRIDGE", 16);

    // layerName[0-7] at body[148-275] (16B each) — CDJ model name
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n] && layers[(size_t)n]->deviceName.isNotEmpty())
            writeString(d + 148 + n * 16, layers[(size_t)n]->deviceName, 16);
}

// ── TIME (154B) ──────────────────────────────
void buildTime(uint8_t* out, NodeIdentity& id,
               const std::array<LayerState*, 8>& layers)
{
    std::memset(out, 0, SZ_TIME);
    buildHeader(out, TYPE_TIME, id);
    uint8_t* d = out + HDR_SIZE;  // body 130B

    int64_t now = juce::Time::currentTimeMillis();

    // layerCurrentTime[0-7] at body[0-31]
    for (int n = 0; n < 8; n++)
    {
        auto* ld = layers[(size_t)n];
        if (!ld) continue;
        float ms = ld->timecodeMs;
        if ((ld->state == PlayState::PLAYING || ld->state == PlayState::LOOPING)
            && ld->updateTime > 0 && ld->bpm > 0)
        {
            ms += (float)(now - ld->updateTime) * (1.0f + ld->pitch / 100.0f);
        }
        writeU32LE(d + n * 4, (uint32_t)juce::jmax(0.0f, ms));
    }

    // layerTotalTime[0-7] at body[32-63]
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n])
            writeU32LE(d + 32 + n * 4, (uint32_t)layers[(size_t)n]->totalLengthMs);

    // layerBeatmarker[0-7] at body[64-71]
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n])
            d[64 + n] = layers[(size_t)n]->beatPhase;

    // layerState[0-7] at body[72-79]
    for (int n = 0; n < 8; n++)
        if (layers[(size_t)n])
            d[72 + n] = toTCNetState(layers[(size_t)n]->state);

    d[81] = 0x00;  // generalSMPTEMode

    // layerTimecode[0-7] at body[82-129] (6B each)
    for (int n = 0; n < 8; n++)
    {
        auto* ld = layers[(size_t)n];
        if (!ld) continue;

        float ms = ld->timecodeMs;
        bool isPlaying = ld->state == PlayState::PLAYING || ld->state == PlayState::LOOPING;
        if (isPlaying && ld->updateTime > 0 && ld->bpm > 0)
            ms += (float)(now - ld->updateTime);

        int totalSec = (int)(ms / 1000.0f);
        int h = totalSec / 3600;
        int m = (totalSec % 3600) / 60;
        int s = totalSec % 60;
        int frames = (int)(std::fmod(ms, 1000.0f) / 33.33f);

        int off = 82 + n * 6;
        d[off + 0] = 0;
        d[off + 1] = isPlaying ? 1 : 0;
        d[off + 2] = (uint8_t)h;
        d[off + 3] = (uint8_t)m;
        d[off + 4] = (uint8_t)s;
        d[off + 5] = (uint8_t)frames;
    }
}

// ── DATA MetricsData (122B) ──────────────────
void buildDataMetrics(uint8_t* out, NodeIdentity& id,
                      int layerIdx, const LayerState* layer, float /*fader*/)
{
    std::memset(out, 0, SZ_METRICS);
    buildHeader(out, TYPE_DATA, id);
    uint8_t* d = out + HDR_SIZE;  // body 98B

    d[0] = 0x02;  // sub-type MetricsData
    d[1] = (uint8_t)layerIdx;

    if (layer)
    {
        d[3] = toTCNetState(layer->state);
        d[5] = 0x01;  // syncMaster
        d[7] = layer->beatPhase;

        writeU32LE(d + 8, (uint32_t)layer->totalLengthMs);

        float curMs = layer->timecodeMs;
        bool isPlaying = layer->state == PlayState::PLAYING || layer->state == PlayState::LOOPING;
        if (isPlaying && layer->updateTime > 0 && layer->bpm > 0)
            curMs += (float)(juce::Time::currentTimeMillis() - layer->updateTime);

        writeU32LE(d + 12, (uint32_t)juce::jmax(0.0f, curMs));
        writeU32LE(d + 16, isPlaying ? 0x8000u : 0u);

        writeU32LE(d + 88, (uint32_t)std::round(layer->bpm * 100.0f));
        writeU16LE(d + 92, 0x4000);  // pitchBend center
        writeU32LE(d + 94, (uint32_t)layer->trackId);
    }
}

// ── DATA MetaData (548B) ─────────────────────
void buildDataMeta(uint8_t* out, NodeIdentity& id,
                   int layerIdx, const LayerState* layer)
{
    std::memset(out, 0, SZ_META);
    buildHeader(out, TYPE_DATA, id);
    uint8_t* d = out + HDR_SIZE;  // body 524B

    d[0] = 0x04;  // sub-type MetaData
    d[1] = (uint8_t)layerIdx;

    if (layer)
    {
        // artist at body[5], max 255 bytes
        if (layer->artistName.isNotEmpty())
        {
            auto utf8 = layer->artistName.toUTF8();
            int len = juce::jmin((int)std::strlen(utf8), 255);
            std::memcpy(d + 5, utf8, (size_t)len);
        }

        // track name at body[261], max 255 bytes
        if (layer->trackName.isNotEmpty())
        {
            auto utf8 = layer->trackName.toUTF8();
            int len = juce::jmin((int)std::strlen(utf8), 255);
            std::memcpy(d + 261, utf8, (size_t)len);
        }

        writeU16LE(d + 517, 0);  // trackKey
        writeU32LE(d + 519, (uint32_t)layer->trackId);
    }
}

// ── APP response (62B) ───────────────────────
void buildAppResponse(uint8_t* out, NodeIdentity& id, int listenerPort)
{
    std::memset(out, 0, SZ_APP);
    buildHeader(out, TYPE_APP, id);
    uint8_t* d = out + HDR_SIZE;
    d[0] = 0xFF; d[1] = 0xFF; d[2] = 0x14; d[3] = 0;
    writeU32LE(d + 4, 1);
    writeU32LE(d + 8, 1);
    writeU16LE(d + 20, (uint16_t)listenerPort);
}

// ── Notification (30B) ───────────────────────
void buildNotification(uint8_t* out, NodeIdentity& id)
{
    std::memset(out, 0, SZ_NOTIFY);
    buildHeader(out, TYPE_NOTIFY, id);
    uint8_t* d = out + HDR_SIZE;
    d[0] = 0xFF; d[1] = 0xFF; d[2] = 0xFF; d[3] = 0x00;
    d[4] = 0x1E; d[5] = 0x00;
}

} // namespace TCNet
