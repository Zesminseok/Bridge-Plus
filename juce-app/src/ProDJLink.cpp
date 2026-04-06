#include "ProDJLink.h"

namespace ProDJLink
{

bool validateHeader(const uint8_t* data, int size)
{
    if (size < 11) return false;
    for (int i = 0; i < MAGIC_LEN; i++)
        if (data[i] != MAGIC[i]) return false;
    return true;
}

uint8_t getPacketType(const uint8_t* data, int size)
{
    return (size > 0x0A) ? data[0x0A] : 0;
}

juce::String getDeviceName(const uint8_t* data, int size)
{
    if (size < 0x1B) return {};
    char buf[17] = {};
    std::memcpy(buf, data + 0x0B, 16);
    return juce::String(buf).trim();
}

bool parseCDJStatus(const uint8_t* data, int size, CDJStatus& out)
{
    if (size < 0xCC) return false;

    out.playerNum = data[0x24];
    if (out.playerNum < 1 || out.playerNum > 6) return false;

    out.name = getDeviceName(data, size);
    out.state = p1ToPlayState(data[0x7B]);

    // Track BPM (uint16BE at 0x92, ×100)
    uint16_t bpmRaw = (uint16_t)(data[0x92] << 8 | data[0x93]);
    out.trackBpm = (bpmRaw > 0 && bpmRaw != 0xFFFF) ? bpmRaw / 100.0f : 0.0f;

    // Pitch: signed offset from 0x100000 at 0x8C-0x8F
    uint32_t pitchRaw = (uint32_t)(data[0x8C] << 24 | data[0x8D] << 16 | data[0x8E] << 8 | data[0x8F]);
    out.pitch = ((float)pitchRaw - 0x100000) / (float)0x100000 * 100.0f;

    // Effective BPM
    out.effectiveBpm = out.trackBpm > 0 ? out.trackBpm * (1.0f + out.pitch / 100.0f) : 0.0f;

    // Beat info
    if (size > 0xA6)
    {
        out.beatNum      = (int)(data[0xA0] << 24 | data[0xA1] << 16 | data[0xA2] << 8 | data[0xA3]);
        out.barsRemaining = (int)(data[0xA4] << 8 | data[0xA5]);
        out.beatInBar    = data[0xA6];
    }

    // Track ID
    out.trackId       = (int)(data[0x2C] << 24 | data[0x2D] << 16 | data[0x2E] << 8 | data[0x2F]);
    out.trackDeviceId = data[0x28];
    out.slot          = data[0x29];
    out.trackType     = data[0x2A];
    out.hasTrack      = data[0x29] > 0;

    // Flags at 0x89
    uint8_t flags = (size > 0x89) ? data[0x89] : 0;
    out.sync   = (flags & 0x10) != 0;
    out.master = (flags & 0x20) != 0;
    out.onAir  = (flags & 0x08) != 0;

    return true;
}

bool parseDJMFaders(const uint8_t* data, int size, std::array<float, 4>& out)
{
    if (size < 0x70) return false;
    const int offsets[] = {0x24, 0x3C, 0x54, 0x6C};
    for (int c = 0; c < 4; c++)
    {
        int off = offsets[c];
        if (off + 1 >= size) { out[(size_t)c] = 0; continue; }
        uint16_t raw = (uint16_t)(data[off] << 8 | data[off + 1]);
        out[(size_t)c] = std::round(raw / 1023.0f * 255.0f);
    }
    return true;
}

bool parseDJMMeter(const uint8_t* data, int size, std::array<float, 4>& out)
{
    if (size < 0x180) return false;
    const int MBASE = 0xA4, MSTEP = 0x3C;
    for (int c = 0; c < 4; c++)
    {
        float peak = 0;
        for (int b = 0; b < 15; b++)
        {
            int off = MBASE + c * MSTEP + b * 2;
            if (off + 1 < size)
            {
                float v = (float)(data[off] << 8 | data[off + 1]);
                if (v > peak) peak = v;
            }
        }
        out[(size_t)c] = std::min(255.0f, std::round(peak / 9200.0f * 255.0f));
    }
    return true;
}

bool parseDJMOnAir(const uint8_t* data, int size, std::array<bool, 4>& out)
{
    if (size < 0x2C) return false;
    out[0] = data[0x25] != 0;
    out[1] = data[0x27] != 0;
    out[2] = data[0x29] != 0;
    out[3] = data[0x2B] != 0;
    return true;
}

bool parsePrecisePosition(const uint8_t* data, int size, PrecisePos& out)
{
    if (size < 0x3C) return false;
    if (data[0x20] != 0x02) return false;

    out.playerNum = data[0x21];
    out.durSec  = (float)(data[0x24] << 24 | data[0x25] << 16 | data[0x26] << 8 | data[0x27]);
    out.posMs   = (float)(data[0x28] << 24 | data[0x29] << 16 | data[0x2A] << 8 | data[0x2B]);

    uint32_t bpmRaw = (uint32_t)(data[0x38] << 24 | data[0x39] << 16 | data[0x3A] << 8 | data[0x3B]);
    out.bpmEff = bpmRaw / 10.0f;
    return true;
}

void buildKeepAlive(uint8_t* out, int playerNum, const uint8_t* mac, const uint8_t* ip4)
{
    std::memset(out, 0, 54);
    std::memcpy(out, MAGIC, MAGIC_LEN);
    out[0x0A] = 0x06;  // type = keep-alive

    const char* name = "BRIDGE-CLONE";
    std::memcpy(out + 0x0C, name, 12);

    out[0x20] = 0x01;
    out[0x21] = 0x01;
    out[0x23] = 0x36;
    out[0x24] = (uint8_t)playerNum;
    out[0x25] = 0x01;  // device type = CDJ

    if (mac) std::memcpy(out + 0x26, mac, 6);
    if (ip4) std::memcpy(out + 0x2C, ip4, 4);

    out[0x30] = 0x08;
    out[0x34] = 0x05;
    out[0x35] = 0x64;
}

} // namespace ProDJLink
