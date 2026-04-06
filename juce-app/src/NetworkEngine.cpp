#include "NetworkEngine.h"

NetworkEngine::NetworkEngine()
    : Thread("NetworkEngine")
{
}

NetworkEngine::~NetworkEngine()
{
    stop();
}

bool NetworkEngine::start(const juce::String& /*broadcastAddr*/)
{
    if (running.load())
        return true;

    // Bind UDP sockets for Pro DJ Link
    socket50001 = std::make_unique<juce::DatagramSocket>(false);
    socket50002 = std::make_unique<juce::DatagramSocket>(false);

    if (!socket50001->bindToPort(50001) || !socket50002->bindToPort(50002))
    {
        DBG("[NET] Failed to bind UDP ports 50001/50002");
        socket50001 = nullptr;
        socket50002 = nullptr;
        return false;
    }

    DBG("[NET] UDP 50001 + 50002 active");
    running.store(true);
    startThread(juce::Thread::Priority::normal);
    return true;
}

void NetworkEngine::stop()
{
    running.store(false);
    if (socket50001) socket50001->shutdown();
    if (socket50002) socket50002->shutdown();
    stopThread(2000);
    socket50001 = nullptr;
    socket50002 = nullptr;
    DBG("[NET] stopped");
}

void NetworkEngine::run()
{
    uint8_t buf[2048];

    while (!threadShouldExit() && running.load())
    {
        // Poll CDJ status packets (port 50002)
        if (socket50002 && socket50002->waitUntilReady(true, 50) > 0)
        {
            juce::String senderIP;
            int senderPort = 0;
            int bytesRead = socket50002->read(buf, sizeof(buf), false, senderIP, senderPort);

            if (bytesRead > 0)
            {
                parseCDJStatus(buf, bytesRead);
            }
        }
    }
}

void NetworkEngine::parseCDJStatus(const uint8_t* data, int size)
{
    // Pro DJ Link status packet parsing
    // Header: 51 73 70 74 31 57 6d 4a 4f 4c ("Qspt1WmJOL")
    if (size < 0x28)
        return;

    // Check Pro DJ Link header
    if (data[0] != 0x51 || data[1] != 0x73 || data[2] != 0x70 || data[3] != 0x74)
        return;

    uint8_t packetType = data[0x0A];

    // Type 0x0A = CDJ status update
    if (packetType == 0x0A && size >= 0xCC)
    {
        int playerNum = data[0x21];
        // BPM: bytes 0x92-0x93, divide by 100
        float bpm = ((data[0x92] << 8) | data[0x93]) / 100.0f;
        // Position: bytes 0x64-0x67 (32-bit, in 1/1000 of track)
        // Simplified — full implementation needs pitch/position tracking

        if (onCDJStatus)
            onCDJStatus(playerNum, 0.0f, bpm);
    }
}
