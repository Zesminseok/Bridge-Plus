#pragma once
#include <JuceHeader.h>
#include "WaveformComponent.h"
#include "NetworkEngine.h"

class MainComponent : public juce::Component,
                      private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    void timerCallback() override;

    // Test: load audio file and analyze waveform
    void loadTestAudio();
    std::vector<WaveformPoint> analyzeAudio(const juce::AudioBuffer<float>& buffer, double sampleRate);

    // UI Components
    WaveformComponent waveform;
    juce::TextButton startBtn { "START" };
    juce::TextButton loadBtn  { "Load Audio" };
    juce::Label statusLabel;

    // Network
    NetworkEngine network;

    // Playback simulation
    float testPosition = 0.0f;
    float testDuration = 0.0f;
    bool playing = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
