#pragma once
#include <JuceHeader.h>
#include "BridgeEngine.h"

/**
 * DeckPanel - single virtual deck display and controls
 */
class DeckPanel : public juce::Component
{
public:
    DeckPanel(int deckNum, BridgeEngine& engine);
    void paint(juce::Graphics& g) override;
    void resized() override;
    void updateDisplay();

private:
    int deckNum;
    BridgeEngine& engine;

    juce::Label titleLabel, artistLabel, bpmLabel, timeLabel, stateLabel;
    juce::TextButton loadBtn  { "LOAD" };
    juce::TextButton playBtn  { juce::CharPointer_UTF8("\xe2\x96\xb6") };   // ▶
    juce::TextButton pauseBtn { "||" };
    juce::TextButton stopBtn  { juce::CharPointer_UTF8("\xe2\x96\xa0") };   // ■
    juce::TextButton cueBtn   { "CUE" };
    juce::Slider volumeSlider;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DeckPanel)
};

/**
 * MainComponent - main UI with audio playback
 */
class MainComponent : public juce::AudioAppComponent,
                      private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    // AudioAppComponent
    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override;
    void releaseResources() override;

    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    void timerCallback() override;
    void layoutDecks();

    BridgeEngine engine;
    double currentSampleRate = 44100.0;

    // UI
    juce::TextButton startBtn { "START BRIDGE" };
    juce::TextButton addDeckBtn { "+ DECK" };
    juce::Label statusLabel;
    juce::Label versionLabel;

    std::array<std::unique_ptr<DeckPanel>, 8> deckPanels;
    int visibleDecks = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
