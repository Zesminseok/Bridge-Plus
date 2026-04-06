#pragma once
#include <JuceHeader.h>
#include "BridgeEngine.h"

// ── Original Electron Color Palette ──────────
namespace C
{
    const juce::Colour bg       (0xff111318);
    const juce::Colour bg2      (0xff1a1c20);
    const juce::Colour bg3      (0xff1e2024);
    const juce::Colour bg4      (0xff282a2e);
    const juce::Colour bgLo     (0xff0c0e12);
    const juce::Colour bgHi     (0xff333539);

    const juce::Colour tx       (0xffe2e2e8);
    const juce::Colour tx2      (0xffbbcac0);
    const juce::Colour tx3      (0xff85948b);
    const juce::Colour tx4      (0xff3c4a42);

    const juce::Colour grn      (0xff5af0b3);
    const juce::Colour grn2     (0xff34d399);
    const juce::Colour blu      (0xffa4c9ff);
    const juce::Colour ylw      (0xffffd16d);
    const juce::Colour ylw2     (0xffecb210);
    const juce::Colour red      (0xffffb4ab);
    const juce::Colour pur      (0xffa78bfa);
    const juce::Colour org      (0xfffb923c);

    const juce::Colour bdr      (0x263c4a42);
    const juce::Colour bdr2     (0x4d3c4a42);
}

/**
 * CircleLF - Custom LookAndFeel for circular CDJ-style CUE/PLAY buttons.
 */
class CircleLF : public juce::LookAndFeel_V4
{
public:
    void drawButtonBackground(juce::Graphics& g, juce::Button& b,
                              const juce::Colour&, bool isOver, bool isDown) override
    {
        auto bounds = b.getLocalBounds().toFloat().reduced(2.5f);
        auto bg  = b.findColour(juce::TextButton::buttonColourId);
        auto col = b.findColour(juce::TextButton::textColourOffId);
        if (isDown) bg = bg.brighter(0.15f);
        else if (isOver) bg = bg.brighter(0.05f);
        g.setColour(bg);
        g.fillEllipse(bounds);
        g.setColour(col.withAlpha(0.85f));
        g.drawEllipse(bounds, 3.0f);
    }

    void drawButtonText(juce::Graphics& g, juce::TextButton& b,
                        bool, bool) override
    {
        g.setColour(b.findColour(juce::TextButton::textColourOffId));
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText(b.getButtonText(), b.getLocalBounds(), juce::Justification::centred);
    }
};

/**
 * DeckPanel - CDJ-3000 style deck card.
 * Adapts layout based on card height:
 *   >= 280px: full (art + zoom wf)
 *   >= 180px: medium (small art + short zoom wf)
 *   <  180px: compact (no art, overview only, horizontal)
 */
class DeckPanel : public juce::Component
{
public:
    DeckPanel(int deckNum, BridgeEngine& engine);
    ~DeckPanel() override;
    void paint(juce::Graphics& g) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent& e) override;
    void mouseUp(const juce::MouseEvent& e) override;
    void updateDisplay();

private:
    int deckNum;
    BridgeEngine& engine;

    juce::Label titleLabel, artistLabel;

    juce::TextButton cueBtn   { "CUE" };
    juce::TextButton playBtn  { juce::CharPointer_UTF8("\xe2\x96\xb6") };
    juce::TextButton loadBtn  { "LOAD" };
    juce::TextButton ejectBtn { "EJECT" };

    CircleLF circleLF;

    PlayState displayState = PlayState::IDLE;
    uint8_t   beatPhase = 0;

    // Layout areas (set in resized, used in paint)
    juce::Rectangle<int> artBounds;
    juce::Rectangle<int> ovWfBounds;
    juce::Rectangle<int> zoomWfBounds;
    juce::Rectangle<int> phasorBounds;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DeckPanel)
};

/**
 * MainComponent - Bridge+ main window.
 * Tabs: LINK | PRO DJ LINK | SETTINGS
 */
class MainComponent : public juce::AudioAppComponent,
                      private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void prepareToPlay(int, double sampleRate) override;
    void getNextAudioBlock(const juce::AudioSourceChannelInfo&) override;
    void releaseResources() override;
    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    void timerCallback() override;
    void layoutDecks();
    void layoutSettings();
    void addDeck();

    BridgeEngine engine;
    double currentSampleRate = 44100.0;

    // Header
    juce::TextButton startBtn { "START" };
    juce::Label statusLabel, versionLabel;

    // Tabs (4: LINK, PRO DJ LINK, TCNet, SETTINGS)
    enum Tab { TAB_LINK = 0, TAB_PDJL = 1, TAB_TCNET = 2, TAB_SETTINGS = 3 };
    Tab activeTab = TAB_LINK;
    std::array<juce::TextButton, 4> tabBtns;

    // Status bar
    juce::Label tcnetBadge, arenaBadge, deckBadge, uptimeBadge;

    // Mode bar: global HW/VIR toggle + add deck
    juce::TextButton modeToggleBtn { "VIR MODE" };
    juce::TextButton addDeckBtn    { "+ DECK" };
    bool globalHWMode = false;

    // Decks (max 6, matching Electron UI)
    std::array<std::unique_ptr<DeckPanel>, 6> deckPanels;
    int visibleDecks = 0;
    static constexpr int kMaxDecks = 6;

    // Settings
    juce::Label       nodeNameLabel, tcnetIfaceLabel, pdjlIfaceLabel, fpsLabel;
    juce::TextEditor  nodeNameEditor;
    juce::ComboBox    tcnetIfaceSelector, pdjlIfaceSelector, fpsSelector;

    // Bottom
    juce::Label packetLabel;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
