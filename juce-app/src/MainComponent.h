#pragma once
#include <JuceHeader.h>
#include "BridgeEngine.h"

/**
 * DeckPanel — displays a single virtual deck's state and controls
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
    juce::TextButton loadBtn { "LOAD" };
    juce::TextButton playBtn { "PLAY" };
    juce::TextButton pauseBtn { "PAUSE" };
    juce::TextButton stopBtn { "STOP" };
    juce::TextButton cueBtn { "CUE" };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DeckPanel)
};

/**
 * MainComponent — main UI window
 */
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

    BridgeEngine engine;

    // UI
    juce::TextButton startBtn { "START BRIDGE" };
    juce::Label statusLabel;
    juce::Label versionLabel;

    std::array<std::unique_ptr<DeckPanel>, 4> deckPanels;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
