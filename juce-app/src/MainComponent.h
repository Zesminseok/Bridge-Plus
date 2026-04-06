#pragma once
#include <JuceHeader.h>
#include "BridgeEngine.h"

// ── Stitch Material Design 3 Color Tokens ────
namespace Theme
{
    // Surface hierarchy
    const juce::Colour background    (0xff091610);
    const juce::Colour surface       (0xff091610);
    const juce::Colour surfDim       (0xff091610);
    const juce::Colour surfBright    (0xff2f3c35);
    const juce::Colour surfContLow   (0xff111e18);
    const juce::Colour surfCont      (0xff15221c);
    const juce::Colour surfContHigh  (0xff1f2d26);
    const juce::Colour surfContHi2   (0xff2a3831);
    const juce::Colour surfContLo2   (0xff05110b);
    const juce::Colour surfVariant   (0xff2a3831);

    // Primary (green)
    const juce::Colour primary       (0xffcbffe2);
    const juce::Colour primaryCont   (0xff5af0b3);
    const juce::Colour primaryDim    (0xff45dfa3);
    const juce::Colour onPrimary     (0xff003825);
    const juce::Colour onPrimaryCont (0xff006b49);

    // Secondary (blue)
    const juce::Colour secondary     (0xffa4c9ff);
    const juce::Colour secondaryCont (0xff224a79);
    const juce::Colour onSecondary   (0xff00315d);

    // Tertiary (purple)
    const juce::Colour tertiary      (0xfff8f0ff);
    const juce::Colour tertiaryCont  (0xffddd0ff);
    const juce::Colour tertiaryDim   (0xffcebdff);
    const juce::Colour onTertiary    (0xff381385);
    const juce::Colour tertiaryAccent(0xffa78bfa);

    // Text
    const juce::Colour onSurface     (0xffd7e6dc);
    const juce::Colour onSurfVar     (0xffbbcac0);
    const juce::Colour outline       (0xff85948b);
    const juce::Colour outlineVar    (0xff3c4a42);

    // Semantic
    const juce::Colour error         (0xffffb4ab);
    const juce::Colour errorCont     (0xff93000a);
    const juce::Colour surfTint      (0xff45dfa3);

    // Custom accent (from original Electron)
    const juce::Colour ylw           (0xffffd16d);
    const juce::Colour ylw2          (0xffecb210);
    const juce::Colour org           (0xfffb923c);

    // Glow shadows
    inline juce::Colour glowGreen()  { return primaryCont.withAlpha(0.3f); }
    inline juce::Colour glowYellow() { return ylw.withAlpha(0.3f); }
    inline juce::Colour glowPurple() { return tertiaryAccent.withAlpha(0.3f); }
}

/**
 * DeckPanel - CDJ-style deck card (Stitch design)
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

    juce::Label titleLabel, artistLabel, bpmLabel, timeLabel;

    juce::TextButton playBtn  { juce::CharPointer_UTF8("\xe2\x96\xb6") };
    juce::TextButton cueBtn   { "CUE" };
    juce::TextButton loadBtn  { "LOAD" };
    juce::TextButton ejectBtn { "EJECT" };
    juce::TextButton hwBtn    { "VIR" };

    juce::Slider volumeSlider;

    PlayState displayState = PlayState::IDLE;
    uint8_t beatPhase = 0;
    bool syncFlag = false, masterFlag = false, onAirFlag = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(DeckPanel)
};

/**
 * OutputLayerPanel - TCNet output layer card (A, B, M)
 */
class OutputLayerPanel : public juce::Component
{
public:
    OutputLayerPanel(const juce::String& name, juce::Colour accent, BridgeEngine& engine, int layerIdx);
    void paint(juce::Graphics& g) override;
    void resized() override;
    void updateDisplay();

private:
    juce::String layerName;
    juce::Colour accentCol;
    BridgeEngine& engine;
    int layerIndex;

    juce::Label timecodeLabel;
    juce::ComboBox sourceSelector;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OutputLayerPanel)
};

/**
 * MainComponent - Bridge+ full application (Stitch design)
 */
class MainComponent : public juce::AudioAppComponent,
                      private juce::Timer
{
public:
    MainComponent();
    ~MainComponent() override;

    void prepareToPlay(int samplesPerBlockExpected, double sampleRate) override;
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override;
    void releaseResources() override;

    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    void timerCallback() override;
    void layoutDecks();
    void layoutSettings();
    void layoutOutputLayers();
    void addDeck();

    BridgeEngine engine;
    double currentSampleRate = 44100.0;

    // ── Header ──
    juce::TextButton startBtn { "START BRIDGE" };
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

    // ── Deck Grid ──
    std::array<std::unique_ptr<DeckPanel>, 8> deckPanels;
    int visibleDecks = 0;

    // ── Output Layers (TCNet tab) ──
    std::unique_ptr<OutputLayerPanel> layerA, layerB, layerM;

    // ── Settings (SETTINGS tab) ──
    juce::Label nodeNameLabel { {}, "Node Name" };
    juce::TextEditor nodeNameEditor;
    juce::Label ifaceLabel { {}, "Network Interface" };
    juce::ComboBox ifaceSelector;
    juce::Label fpsLabel { {}, "TCNet FPS" };
    juce::ComboBox fpsSelector;

    // ── Bottom Bar ──
    juce::Label packetLabel;
    juce::Label latencyLabel;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainComponent)
};
