#pragma once
#include <JuceHeader.h>
#include "BridgeEngine.h"

// ── Color Scheme (matching Electron CSS) ────
namespace Theme
{
    const juce::Colour bg       (0xff111318);
    const juce::Colour bg2      (0xff1a1c20);
    const juce::Colour bg3      (0xff1e2024);
    const juce::Colour bg4      (0xff282a2e);
    const juce::Colour bgLowest (0xff0c0e12);
    const juce::Colour bgHighest(0xff333539);

    const juce::Colour tx       (0xffe2e2e8);
    const juce::Colour tx2      (0xffbbcac0);
    const juce::Colour tx3      (0xff85948b);
    const juce::Colour tx4      (0xff3c4a42);

    const juce::Colour grn      (0xff5af0b3);
    const juce::Colour grn2     (0xff34d399);
    const juce::Colour blu      (0xffa4c9ff);
    const juce::Colour blu2     (0xff0267b8);
    const juce::Colour ylw      (0xffffd16d);
    const juce::Colour ylw2     (0xffecb210);
    const juce::Colour red      (0xffffb4ab);
    const juce::Colour pur      (0xffa78bfa);
    const juce::Colour org      (0xfffb923c);

    const juce::Colour bdr      (0x263c4a42);
    const juce::Colour bdr2     (0x4d3c4a42);
}

/**
 * DeckPanel - CDJ-style deck card
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

    // Labels
    juce::Label titleLabel, artistLabel, bpmLabel, timeLabel;

    // Buttons - CDJ style
    juce::TextButton playBtn  { juce::CharPointer_UTF8("\xe2\x96\xb6") };   // triangle
    juce::TextButton cueBtn   { "CUE" };
    juce::TextButton loadBtn  { "LOAD" };
    juce::TextButton ejectBtn { "EJECT" };
    juce::TextButton hwBtn    { "VIR" };

    // Volume
    juce::Slider volumeSlider;

    // Display state
    PlayState displayState = PlayState::IDLE;
    uint8_t beatPhase = 0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DeckPanel)
};

/**
 * MainComponent - full Bridge+ UI with audio playback
 * Matches Electron design: header, tabs, status, mode bar, decks, bottom bar
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
    void addDeck();

    BridgeEngine engine;
    double currentSampleRate = 44100.0;

    // ── Header ──
    juce::TextButton startBtn { "START BRIDGE" };
    juce::Label statusDotLabel;
    juce::Label statusTextLabel;
    juce::Label versionLabel;

    // ── Tab Bar ──
    enum Tab { TAB_LINK = 0, TAB_PDJL, TAB_TCNET, TAB_SETTINGS };
    Tab activeTab = TAB_LINK;
    std::array<juce::TextButton, 4> tabBtns;

    // ── Status Bar ──
    juce::Label tcnetBadge, arenaBadge, deckBadge, uptimeBadge;

    // ── Mode Bar ──
    juce::TextButton virtualBtn { "VIRTUAL" };
    juce::TextButton hwModeBtn  { "HARDWARE" };
    juce::TextButton addDeckBtn { "+ DECK" };
    bool globalHWMode = false;

    // ── Deck Grid ──
    std::array<std::unique_ptr<DeckPanel>, 8> deckPanels;
    int visibleDecks = 0;

    // ── Bottom Bar ──
    juce::Label packetLabel;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
