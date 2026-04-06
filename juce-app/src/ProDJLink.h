#pragma once
#include <JuceHeader.h>
#include "DeckState.h"

namespace ProDJLink
{
    // Magic header: "Qspt1WmJOL"
    static const uint8_t MAGIC[] = {0x51,0x73,0x70,0x74,0x31,0x57,0x6D,0x4A,0x4F,0x4C};
    static constexpr int MAGIC_LEN = 10;

    // Packet types
    static constexpr uint8_t TYPE_CDJ_STATUS   = 0x0A;
    static constexpr uint8_t TYPE_DJM_FADER    = 0x29;
    static constexpr uint8_t TYPE_DJM_FADER2   = 0x39;
    static constexpr uint8_t TYPE_DJM_ONAIR    = 0x03;
    static constexpr uint8_t TYPE_DJM_METER    = 0x58;
    static constexpr uint8_t TYPE_CDJ_BEAT     = 0x28;
    static constexpr uint8_t TYPE_CDJ_WF       = 0x56;
    static constexpr uint8_t TYPE_PRECISE_POS  = 0x0B;
    static constexpr uint8_t TYPE_ANNOUNCE      = 0x06;

    // Ports
    static constexpr int PORT_ANNOUNCE = 50000;
    static constexpr int PORT_STATUS1  = 50001;
    static constexpr int PORT_STATUS2  = 50002;

    // Validate PDJL header
    bool validateHeader(const uint8_t* data, int size);

    // Get packet type (byte at offset 0x0A)
    uint8_t getPacketType(const uint8_t* data, int size);

    // Get device name from packet (bytes 0x0B-0x1A)
    juce::String getDeviceName(const uint8_t* data, int size);

    // Parse CDJ status (type 0x0A, min 0xCC bytes)
    bool parseCDJStatus(const uint8_t* data, int size, CDJStatus& out);

    // Parse DJM faders (type 0x29 or 0x39, min 0x70 bytes)
    bool parseDJMFaders(const uint8_t* data, int size, std::array<float, 4>& out);

    // Parse DJM meter (type 0x58, min 0x180 bytes)
    bool parseDJMMeter(const uint8_t* data, int size, std::array<float, 4>& out);

    // Parse DJM on-air (type 0x03, min 0x2C bytes)
    bool parseDJMOnAir(const uint8_t* data, int size, std::array<bool, 4>& out);

    // Parse Precise Position (type 0x0B, min 0x3C bytes)
    struct PrecisePos { int playerNum; float posMs; float durSec; float bpmEff; };
    bool parsePrecisePosition(const uint8_t* data, int size, PrecisePos& out);

    // Build keep-alive announcement packet (54 bytes)
    void buildKeepAlive(uint8_t* out, int playerNum, const uint8_t* mac, const uint8_t* ip4);
}
