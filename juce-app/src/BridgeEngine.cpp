#include "BridgeEngine.h"

// ── PDJL Receiver Thread ─────────────────────
class BridgeEngine::PDJLReceiver : public juce::Thread
{
public:
    PDJLReceiver(BridgeEngine& e) : Thread("PDJLReceiver"), engine(e) {}

    void run() override
    {
        sock1 = std::make_unique<juce::DatagramSocket>(false);
        sock2 = std::make_unique<juce::DatagramSocket>(false);

        sock1->bindToPort(ProDJLink::PORT_STATUS1);
        sock2->bindToPort(ProDJLink::PORT_STATUS2);

        uint8_t buf[2048];
        while (!threadShouldExit())
        {
            // Poll port 50002
            if (sock2->waitUntilReady(true, 20) > 0)
            {
                juce::String sender;
                int port = 0;
                int n = sock2->read(buf, sizeof(buf), false, sender, port);
                if (n > 0) engine.handlePDJL(buf, n, sender);
            }
            // Poll port 50001
            if (sock1->waitUntilReady(true, 10) > 0)
            {
                juce::String sender;
                int port = 0;
                int n = sock1->read(buf, sizeof(buf), false, sender, port);
                if (n > 0) engine.handlePDJL(buf, n, sender);
            }
        }
    }

private:
    BridgeEngine& engine;
    std::unique_ptr<juce::DatagramSocket> sock1, sock2;
};

// ── TCNet Receiver Thread ────────────────────
class BridgeEngine::TCNetReceiver : public juce::Thread
{
public:
    TCNetReceiver(BridgeEngine& e) : Thread("TCNetRx"), engine(e) {}

    void run() override
    {
        sock = std::make_unique<juce::DatagramSocket>(false);
        sock->bindToPort(TCNet::PORT_BC);

        uint8_t buf[2048];
        while (!threadShouldExit())
        {
            if (sock->waitUntilReady(true, 50) > 0)
            {
                juce::String sender;
                int port = 0;
                int n = sock->read(buf, sizeof(buf), false, sender, port);
                if (n > 0) engine.handleTCNetMessage(buf, n, sender, port);
            }
        }
    }

private:
    BridgeEngine& engine;
    std::unique_ptr<juce::DatagramSocket> sock;
};

// ── BridgeEngine ─────────────────────────────
BridgeEngine::BridgeEngine()
{
    // Random node ID
    nodeId.nodeId[0] = (uint8_t)(juce::Random::getSystemRandom().nextInt(256));
    nodeId.nodeId[1] = 0xFE;

    // Random node name
    int suffix = juce::Random::getSystemRandom().nextInt(900) + 100;
    snprintf(nodeId.nodeName, sizeof(nodeId.nodeName), "BRIDGE%d", suffix);

    for (int i = 0; i < 8; i++)
        virtualDecks[(size_t)i].setDeviceName("CDJ-3000");
}

BridgeEngine::~BridgeEngine()
{
    stop();
}

bool BridgeEngine::start(const juce::String& /*tcnetIface*/, bool isLocal)
{
    if (running) return true;

    localMode = isLocal;
    startTime = juce::Time::currentTimeMillis();
    packetCount = 0;
    tick = 0;
    dataPhase = 0;

    // Detect broadcast address
    if (isLocal)
    {
        broadcastAddr = "127.0.0.1";
        localAddr = "127.0.0.1";
    }
    else
    {
        // Find first non-loopback IPv4 interface
        auto addresses = juce::IPAddress::getAllAddresses(false);

        for (const auto& addr : addresses)
        {
            auto ip = addr.toString();
            if (ip != "127.0.0.1" && ip.contains(".") && !ip.startsWith("169.254."))
            {
                localAddr = ip;
                auto parts = juce::StringArray::fromTokens(ip, ".", {});
                if (parts.size() == 4)
                    broadcastAddr = parts[0] + "." + parts[1] + "." + parts[2] + ".255";
                break;
            }
        }
        if (broadcastAddr.isEmpty())
            broadcastAddr = "255.255.255.255";
    }

    // Create TX socket
    txSocket = std::make_unique<juce::DatagramSocket>(true);
    txSocket->bindToPort(0);

    running = true;

    // Start network receivers
    if (!isLocal)
    {
        pdjlReceiver = std::make_unique<PDJLReceiver>(*this);
        pdjlReceiver->startThread();
    }

    tcnetReceiver = std::make_unique<TCNetReceiver>(*this);
    tcnetReceiver->startThread();

    // Send initial packets
    sendOptIn();
    sendStatus();

    uint8_t notifyBuf[TCNet::SZ_NOTIFY];
    TCNet::buildNotification(notifyBuf, nodeId);
    sendToAll(notifyBuf, TCNet::SZ_NOTIFY, TCNet::PORT_BC);

    // Start timer at ~30Hz
    startTimerHz(30);

    DBG("BridgeEngine started: name=" + juce::String(nodeId.nodeName)
        + " bc=" + broadcastAddr + " local=" + localAddr);

    return true;
}

void BridgeEngine::stop()
{
    if (!running) return;

    // Send OptOut before stopping
    uint8_t optOut[TCNet::SZ_OPTOUT];
    TCNet::buildOptOut(optOut, nodeId, listenerPort);
    for (int i = 0; i < 3; i++)
        sendToAll(optOut, TCNet::SZ_OPTOUT, TCNet::PORT_BC);

    running = false;
    stopTimer();

    if (pdjlReceiver)  { pdjlReceiver->stopThread(2000);  pdjlReceiver = nullptr; }
    if (tcnetReceiver) { tcnetReceiver->stopThread(2000); tcnetReceiver = nullptr; }

    txSocket = nullptr;

    DBG("BridgeEngine stopped");
}

VirtualDeck& BridgeEngine::getVirtualDeck(int slot)
{
    return virtualDecks[(size_t)juce::jlimit(0, 7, slot)];
}

void BridgeEngine::setVirtualDeckActive(int slot, bool active)
{
    if (slot < 0 || slot > 7) return;
    virtualActive[(size_t)slot] = active;
}

bool BridgeEngine::isVirtualDeckActive(int slot) const
{
    return slot >= 0 && slot < 8 && virtualActive[(size_t)slot];
}

const LayerState* BridgeEngine::getLayerState(int i) const
{
    if (i < 0 || i > 7) return nullptr;
    return layers[(size_t)i].get();
}

void BridgeEngine::updateLayer(int i, const LayerState& data)
{
    if (i < 0 || i > 7) return;
    if (!layers[(size_t)i])
        layers[(size_t)i] = std::make_unique<LayerState>();
    *layers[(size_t)i] = data;
    layers[(size_t)i]->updateTime = juce::Time::currentTimeMillis();
}

int BridgeEngine::getUptimeSeconds() const
{
    return (int)((juce::Time::currentTimeMillis() - startTime) / 1000);
}

juce::String BridgeEngine::getStatusText() const
{
    if (!running) return "Stopped";

    int activeLayers = 0;
    for (int i = 0; i < 8; i++)
        if (layers[(size_t)i]) activeLayers++;

    return "Running | " + juce::String(activeLayers) + " layers, "
        + juce::String(packetCount) + " pkts, "
        + juce::String((int)nodes.size()) + " nodes, "
        + "bc=" + broadcastAddr;
}

// ── Timer (30Hz) ─────────────────────────────
void BridgeEngine::timerCallback()
{
    if (!running) return;

    tick++;

    // Update virtual decks → layers (position comes from audio thread)
    for (int i = 0; i < 8; i++)
    {
        if (virtualActive[(size_t)i])
        {
            LayerState ls;
            virtualDecks[(size_t)i].fillLayerState(ls);
            updateLayer(i, ls);
        }
    }

    // TIME packet every tick (~33ms)
    sendTime();

    // Status + DATA every 5 ticks (~170ms)
    if (tick % 5 == 0)
    {
        sendStatus();
        sendDataCycle();
    }

    // OptIn every 30 ticks (~1s)
    if (tick % 30 == 0)
        sendOptIn();

    // UI update every 5 ticks (~170ms)
    if (tick % 5 == 0)
        onStatusUpdate ? onStatusUpdate() : void();
}

// ── Network sending ──────────────────────────
void BridgeEngine::sendToAll(const uint8_t* data, int size, int port)
{
    if (!running || !txSocket) return;
    txSocket->write(broadcastAddr, port, data, size);
    if (!localMode)
    {
        if (broadcastAddr != "255.255.255.255")
            txSocket->write("255.255.255.255", port, data, size);
        if (localAddr.isNotEmpty())
            txSocket->write(localAddr, port, data, size);
        txSocket->write("127.0.0.1", port, data, size);
    }
}

void BridgeEngine::sendToArenas(const uint8_t* data, int size, int port)
{
    if (!running || !txSocket) return;
    auto now = juce::Time::currentTimeMillis();
    for (auto& [key, node] : nodes)
    {
        if (now - node.lastSeen > 15000) continue;
        txSocket->write(node.ip, port, data, size);
        if (node.listenerPort > 0)
            txSocket->write(node.ip, node.listenerPort, data, size);
    }
}

void BridgeEngine::sendOptIn()
{
    uint8_t buf[TCNet::SZ_OPTIN];
    int nc = juce::jmax(1, (int)nodes.size() + 1);
    TCNet::buildOptIn(buf, nodeId, listenerPort, getUptimeSeconds(), nc);
    sendToAll(buf, TCNet::SZ_OPTIN, TCNet::PORT_BC);
    sendToArenas(buf, TCNet::SZ_OPTIN, TCNet::PORT_BC);
}

void BridgeEngine::sendStatus()
{
    std::array<LayerState*, 8> lp = {};
    for (int i = 0; i < 8; i++)
        lp[(size_t)i] = layers[(size_t)i].get();

    uint8_t buf[TCNet::SZ_STATUS];
    TCNet::buildStatus(buf, nodeId, listenerPort, lp, hwMode);
    sendToAll(buf, TCNet::SZ_STATUS, TCNet::PORT_BC);
    sendToArenas(buf, TCNet::SZ_STATUS, TCNet::PORT_BC);
}

void BridgeEngine::sendTime()
{
    std::array<LayerState*, 8> lp = {};
    for (int i = 0; i < 8; i++)
        lp[(size_t)i] = layers[(size_t)i].get();

    uint8_t buf[TCNet::SZ_TIME];
    TCNet::buildTime(buf, nodeId, lp);
    sendToAll(buf, TCNet::SZ_TIME, TCNet::PORT_TIME);
    sendToArenas(buf, TCNet::SZ_TIME, TCNet::PORT_TIME);
    packetCount++;
}

void BridgeEngine::sendDataCycle()
{
    // 24-phase cycle: Metrics(0-7) → Meta(8-15) → Metrics(16-23)
    int idx = dataPhase;
    int layerIdx, li;
    bool isMeta = false;

    if (idx < 8)       { layerIdx = idx + 1;      li = idx;     }
    else if (idx < 16) { layerIdx = idx - 8 + 1;  li = idx - 8; isMeta = true; }
    else               { layerIdx = idx - 16 + 1;  li = idx - 16; }

    if (layers[(size_t)li])
    {
        if (isMeta)
        {
            uint8_t buf[TCNet::SZ_META];
            TCNet::buildDataMeta(buf, nodeId, layerIdx, layers[(size_t)li].get());
            sendToAll(buf, TCNet::SZ_META, TCNet::PORT_DATA);
            sendToArenas(buf, TCNet::SZ_META, TCNet::PORT_DATA);
        }
        else
        {
            float fader = (li < 4) ? djm.faders[(size_t)li] : 0.0f;
            uint8_t buf[TCNet::SZ_METRICS];
            TCNet::buildDataMetrics(buf, nodeId, layerIdx, layers[(size_t)li].get(), fader);
            sendToAll(buf, TCNet::SZ_METRICS, TCNet::PORT_DATA);
            sendToArenas(buf, TCNet::SZ_METRICS, TCNet::PORT_DATA);
        }
        packetCount++;
    }

    dataPhase = (dataPhase + 1) % 24;
}

// ── TCNet RX ─────────────────────────────────
void BridgeEngine::handleTCNetMessage(const uint8_t* data, int size,
                                       const juce::String& senderIP, int senderPort)
{
    if (size < TCNet::HDR_SIZE) return;
    // Validate magic "TCN"
    if (data[4] != 'T' || data[5] != 'C' || data[6] != 'N') return;

    uint8_t type = data[7];
    char nameRaw[9] = {};
    std::memcpy(nameRaw, data + 8, 8);
    juce::String name(nameRaw);
    name = name.trim();

    // Ignore our own packets
    if (name.startsWithIgnoreCase("BRIDGE")) return;

    if (type == TCNet::TYPE_OPTIN)
    {
        const uint8_t* body = data + TCNet::HDR_SIZE;
        int lPort = (size >= TCNet::HDR_SIZE + 4) ? (body[2] | (body[3] << 8)) : 0;

        char vendorBuf[17] = {}, deviceBuf[17] = {};
        if (size >= TCNet::HDR_SIZE + 40)
        {
            std::memcpy(vendorBuf, body + 8, 16);
            std::memcpy(deviceBuf, body + 24, 16);
        }

        auto key = name + "@" + senderIP;
        bool isNew = nodes.find(key) == nodes.end();

        TCNetNode node;
        node.name = name;
        node.vendor = juce::String(vendorBuf).trim();
        node.device = juce::String(deviceBuf).trim();
        node.nodeType = data[17];
        node.ip = senderIP;
        node.port = senderPort;
        node.listenerPort = lPort;
        node.lastSeen = juce::Time::currentTimeMillis();
        nodes[key] = node;

        if (isNew)
            DBG("TCNet: discovered " + name + "@" + senderIP + " lPort=" + juce::String(lPort));
    }
    else if (type == TCNet::TYPE_APP)
    {
        uint8_t resp[TCNet::SZ_APP];
        TCNet::buildAppResponse(resp, nodeId, listenerPort);
        if (txSocket) txSocket->write(senderIP, senderPort, resp, TCNet::SZ_APP);
    }
    else if (type == 0x14)  // MetadataRequest
    {
        if (size < TCNet::HDR_SIZE + 2) return;
        const uint8_t* body = data + TCNet::HDR_SIZE;
        int layerReq = body[0];
        int li = layerReq - 1;

        if (li >= 0 && li < 8 && layers[(size_t)li])
        {
            uint8_t metaBuf[TCNet::SZ_META];
            TCNet::buildDataMeta(metaBuf, nodeId, layerReq, layers[(size_t)li].get());
            if (txSocket) txSocket->write(senderIP, senderPort, metaBuf, TCNet::SZ_META);

            float fader = (li < 4) ? djm.faders[(size_t)li] : 0.0f;
            uint8_t metricsBuf[TCNet::SZ_METRICS];
            TCNet::buildDataMetrics(metricsBuf, nodeId, layerReq, layers[(size_t)li].get(), fader);
            if (txSocket) txSocket->write(senderIP, senderPort, metricsBuf, TCNet::SZ_METRICS);
        }
    }
}

// ── PDJL RX ──────────────────────────────────
void BridgeEngine::handlePDJL(const uint8_t* data, int size, const juce::String& senderIP)
{
    if (!ProDJLink::validateHeader(data, size)) return;

    uint8_t type = ProDJLink::getPacketType(data, size);
    juce::String devName = ProDJLink::getDeviceName(data, size);

    if (type == ProDJLink::TYPE_CDJ_STATUS)
    {
        CDJStatus cdj;
        if (!ProDJLink::parseCDJStatus(data, size, cdj)) return;

        int li = cdj.playerNum - 1;
        if (li < 0 || li > 7) return;

        // Register device
        auto key = "cdj" + juce::String(cdj.playerNum);
        if (devices.find(key) == devices.end())
        {
            DeviceInfo dev;
            dev.type = "CDJ";
            dev.playerNum = cdj.playerNum;
            dev.name = cdj.name;
            dev.ip = senderIP;
            dev.lastSeen = juce::Time::currentTimeMillis();
            devices[key] = dev;
        }
        else
        {
            devices[key].lastSeen = juce::Time::currentTimeMillis();
        }

        // Update layer if HW mode
        if (hwMode[(size_t)li])
        {
            LayerState ls;
            ls.state = cdj.state;
            ls.bpm = cdj.effectiveBpm;
            ls.pitch = cdj.pitch;
            ls.trackId = cdj.trackId;
            ls.beatPhase = (uint8_t)(juce::jmax(0, cdj.beatInBar - 1) * 64);
            ls.deviceName = cdj.name;

            // Timecode from beat number
            if (cdj.beatNum > 0 && cdj.trackBpm > 0)
            {
                float msPerBeat = 60000.0f / cdj.trackBpm;
                ls.timecodeMs = (float)(cdj.beatNum - 1) * msPerBeat;
            }

            updateLayer(li, ls);
            if (onLayerUpdate) onLayerUpdate(li);
        }
    }
    else if (type == ProDJLink::TYPE_DJM_FADER || type == ProDJLink::TYPE_DJM_FADER2)
    {
        ProDJLink::parseDJMFaders(data, size, djm.faders);
    }
    else if (type == ProDJLink::TYPE_DJM_ONAIR)
    {
        ProDJLink::parseDJMOnAir(data, size, djm.onAir);
    }
    else if (type == ProDJLink::TYPE_DJM_METER)
    {
        std::array<float, 4> meter;
        ProDJLink::parseDJMMeter(data, size, meter);
    }
    else if (type == ProDJLink::TYPE_PRECISE_POS)
    {
        ProDJLink::PrecisePos pp;
        if (ProDJLink::parsePrecisePosition(data, size, pp))
        {
            int li = pp.playerNum - 1;
            if (li >= 0 && li < 8 && hwMode[(size_t)li] && layers[(size_t)li])
            {
                layers[(size_t)li]->timecodeMs = pp.posMs;
                layers[(size_t)li]->totalLengthMs = pp.durSec * 1000.0f;
                layers[(size_t)li]->bpm = pp.bpmEff;
                layers[(size_t)li]->updateTime = juce::Time::currentTimeMillis();
            }
        }
    }
}
