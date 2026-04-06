#pragma once
#include <JuceHeader.h>
#include "DeckState.h"
#include <array>

/**
 * TCNet v3.5 packet builder — byte-accurate match with bridge-core.js
 *
 * Ports: 60000 (broadcast), 60001 (time), 60002 (data)
 * Packet types: OptIn(0x02), OptOut(0x03), Status(0x05),
 *               TIME(0xFE), DATA(0xC8), APP(0x1E), Notify(0x0D)
 */
namespace TCNet
{
    // Constants
    static constexpr int PORT_BC   = 60000;
    static constexpr int PORT_TIME = 60001;
    static constexpr int PORT_DATA = 60002;

    static constexpr int HDR_SIZE  = 24;
    static constexpr int SZ_OPTIN  = 68;
    static constexpr int SZ_OPTOUT = 28;
    static constexpr int SZ_STATUS = 300;
    static constexpr int SZ_TIME   = 154;
    static constexpr int SZ_METRICS = 122;
    static constexpr int SZ_META   = 548;
    static constexpr int SZ_APP    = 62;
    static constexpr int SZ_NOTIFY = 30;

    static constexpr uint8_t TYPE_OPTIN  = 0x02;
    static constexpr uint8_t TYPE_OPTOUT = 0x03;
    static constexpr uint8_t TYPE_STATUS = 0x05;
    static constexpr uint8_t TYPE_DATA   = 0xC8;
    static constexpr uint8_t TYPE_TIME   = 0xFE;
    static constexpr uint8_t TYPE_APP    = 0x1E;
    static constexpr uint8_t TYPE_NOTIFY = 0x0D;

    // Node identity (set once at startup)
    struct NodeIdentity
    {
        uint8_t nodeId[2]  = {0, 0xFE};
        char    nodeName[9] = "BRIDGE00";
        uint8_t nodeType   = 0x02;   // 0x02=Server, 0x04=Client
        uint8_t seq        = 0;
    };

    // Build 24-byte TCNet header
    void buildHeader(uint8_t* out, uint8_t type, NodeIdentity& id);

    // OptIn (68 bytes)
    void buildOptIn(uint8_t* out, NodeIdentity& id, int listenerPort, int uptimeSec, int nodeCount);

    // OptOut (28 bytes)
    void buildOptOut(uint8_t* out, NodeIdentity& id, int listenerPort);

    // Status (300 bytes)
    void buildStatus(uint8_t* out, NodeIdentity& id, int listenerPort,
                     const std::array<LayerState*, 8>& layers,
                     const std::array<bool, 8>& hwMode);

    // TIME (154 bytes) — with interpolation
    void buildTime(uint8_t* out, NodeIdentity& id,
                   const std::array<LayerState*, 8>& layers);

    // DATA MetricsData (122 bytes)
    void buildDataMetrics(uint8_t* out, NodeIdentity& id,
                          int layerIdx, const LayerState* layer, float fader);

    // DATA MetaData (548 bytes)
    void buildDataMeta(uint8_t* out, NodeIdentity& id,
                       int layerIdx, const LayerState* layer);

    // APP response (62 bytes)
    void buildAppResponse(uint8_t* out, NodeIdentity& id, int listenerPort);

    // Notification (30 bytes)
    void buildNotification(uint8_t* out, NodeIdentity& id);
}
