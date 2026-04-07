#pragma once
#include <JuceHeader.h>
#include "DeckState.h"
#include "TCNetSender.h"
#include "ProDJLink.h"
#include "VirtualDeck.h"
#include <array>
#include <map>
#include <mutex>

/**
 * BridgeEngine — central coordinator.
 *
 * Manages 8 layers (virtual or HW), sends TCNet to Resolume,
 * receives Pro DJ Link from CDJs/DJMs.
 */
class BridgeEngine : private juce::Timer
{
public:
    BridgeEngine();
    ~BridgeEngine() override;

    // Start/stop the bridge
    bool start(const juce::String& tcnetIface = {}, bool localMode = false);
    void stop();
    bool isRunning() const { return running; }

    // Virtual decks (0-7)
    VirtualDeck& getVirtualDeck(int slot);
    void setVirtualDeckActive(int slot, bool active);
    bool isVirtualDeckActive(int slot) const;

    // Layer state
    const LayerState* getLayerState(int i) const;
    void updateLayer(int i, const LayerState& data);

    // HW mode
    void setHWMode(int slot, bool hw) { if (slot >= 0 && slot < 8) hwMode[(size_t)slot] = hw; }
    bool isHWMode(int slot) const { return slot >= 0 && slot < 8 && hwMode[(size_t)slot]; }

    // Status
    int getPacketCount() const { return packetCount; }
    int getUptimeSeconds() const;
    int getNodeCount() const { return (int)nodes.size(); }
    juce::String getStatusText() const;

    // Per-type packet counters
    int getTimePacketCount()   const { return pktTime; }
    int getDataPacketCount()   const { return pktData; }
    int getOptInPacketCount()  const { return pktOptIn; }
    int getStatusPacketCount() const { return pktStatus; }

    // DJM
    const DJMStatus& getDJMStatus() const { return djm; }

    // PDJL receiver port (0 = not bound)
    int getPDJLPort() const;  // returns 50001 when active, 0 otherwise

    // Devices
    const std::map<juce::String, DeviceInfo>& getDevices() const { return devices; }

    // TCNet nodes
    const std::map<juce::String, TCNetNode>& getNodes() const { return nodes; }

    // Callbacks (called from timer/network thread)
    std::function<void(int layer)> onLayerUpdate;
    std::function<void()>          onStatusUpdate;
    std::function<void(const juce::String&)> onLog;

private:
    void timerCallback() override;

    // Network
    void sendToAll(const uint8_t* data, int size, int port);
    void sendToArenas(const uint8_t* data, int size, int port);

    // TCNet sending
    void sendOptIn();
    void sendStatus();
    void sendTime();
    void sendDataCycle();

    // TCNet RX
    void startTCNetRx();
    void handleTCNetMessage(const uint8_t* data, int size, const juce::String& senderIP, int senderPort);

    // PDJL RX
    void startPDJLRx();
    void handlePDJL(const uint8_t* data, int size, const juce::String& senderIP);

    // State
    bool running = false;
    int64_t startTime = 0;
    int packetCount = 0;
    int pktTime   = 0;
    int pktData   = 0;
    int pktOptIn  = 0;
    int pktStatus = 0;
    int tick = 0;
    int dataPhase = 0;

    // Identity
    TCNet::NodeIdentity nodeId;

    // Network
    std::unique_ptr<juce::DatagramSocket> txSocket;
    int listenerPort = 0;
    juce::String broadcastAddr;
    juce::String localAddr;
    bool localMode = false;

    // PDJL RX thread
    class PDJLReceiver;
    std::unique_ptr<PDJLReceiver> pdjlReceiver;

    // TCNet RX thread
    class TCNetReceiver;
    std::unique_ptr<TCNetReceiver> tcnetReceiver;

    // Layers
    std::array<std::unique_ptr<LayerState>, 8> layers;
    std::array<bool, 8> hwMode = {};
    std::array<bool, 8> virtualActive = {};
    std::array<VirtualDeck, 8> virtualDecks;

    // DJM
    DJMStatus djm;

    // Nodes
    std::map<juce::String, TCNetNode> nodes;

    // Devices
    std::map<juce::String, DeviceInfo> devices;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(BridgeEngine)
};
