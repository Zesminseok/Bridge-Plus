#pragma once
#include <JuceHeader.h>

// TCNet + Pro DJ Link network engine
// Handles UDP packet parsing for CDJ/DJM status
class NetworkEngine : private juce::Thread
{
public:
    NetworkEngine();
    ~NetworkEngine() override;

    // Start/stop listening
    bool start(const juce::String& broadcastAddr = "255.255.255.255");
    void stop();

    bool isRunning() const { return running.load(); }

    // Callbacks
    std::function<void(int playerNum, float position, float bpm)> onCDJStatus;
    std::function<void(int playerNum, const juce::String& title, const juce::String& artist)> onTrackMeta;

private:
    void run() override;

    std::atomic<bool> running { false };
    std::unique_ptr<juce::DatagramSocket> socket50001; // CDJ status
    std::unique_ptr<juce::DatagramSocket> socket50002; // CDJ announce

    void parseCDJStatus(const uint8_t* data, int size);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(NetworkEngine)
};
