#include "MainComponent.h"

// ── Helpers ──────────────────────────────────
static juce::String formatTime(float ms)
{
    if (ms <= 0) return "00:00.000";
    int totalMs = (int)ms;
    int min = totalMs / 60000;
    int sec = (totalMs % 60000) / 1000;
    int milli = totalMs % 1000;
    return juce::String::formatted("%02d:%02d.%03d", min, sec, milli);
}

static juce::String formatUptime(int secs)
{
    int h = secs / 3600;
    int m = (secs % 3600) / 60;
    int s = secs % 60;
    return juce::String::formatted("%02d:%02d:%02d", h, m, s);
}

// ═══════════════════════════════════════════
// ── DeckPanel ──────────────────────────────
// ═══════════════════════════════════════════

DeckPanel::DeckPanel(int num, BridgeEngine& eng)
    : deckNum(num), engine(eng)
{
    // Title / Artist labels
    auto setupLabel = [this](juce::Label& label, float fontSize, juce::Colour col)
    {
        addAndMakeVisible(label);
        label.setFont(juce::FontOptions(fontSize));
        label.setColour(juce::Label::textColourId, col);
        label.setJustificationType(juce::Justification::centredLeft);
    };

    setupLabel(titleLabel,  15.0f, Theme::tx);
    setupLabel(artistLabel, 12.0f, Theme::tx3);
    setupLabel(bpmLabel,    13.0f, Theme::grn);
    setupLabel(timeLabel,   13.0f, Theme::tx2);

    titleLabel.setText("Empty", juce::dontSendNotification);

    // ── CUE button (yellow) ──
    addAndMakeVisible(cueBtn);
    cueBtn.setColour(juce::TextButton::buttonColourId, Theme::bg4);
    cueBtn.setColour(juce::TextButton::textColourOffId, juce::Colour(0x80ffd16d));
    cueBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).cue();
    };

    // ── PLAY button (green) ──
    addAndMakeVisible(playBtn);
    playBtn.setColour(juce::TextButton::buttonColourId, Theme::bg4);
    playBtn.setColour(juce::TextButton::textColourOffId, juce::Colour(0x805af0b3));
    playBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).playPause();
    };

    // ── LOAD button ──
    addAndMakeVisible(loadBtn);
    loadBtn.setColour(juce::TextButton::buttonColourId, Theme::bg3);
    loadBtn.setColour(juce::TextButton::textColourOffId, Theme::tx3);
    loadBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        auto chooser = std::make_shared<juce::FileChooser>(
            "Select Audio", juce::File::getSpecialLocation(juce::File::userMusicDirectory),
            "*.wav;*.mp3;*.aiff;*.flac;*.m4a;*.aac;*.ogg");

        chooser->launchAsync(
            juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
            [this, fc = chooser](const juce::FileChooser& c)
            {
                auto file = c.getResult();
                if (!file.existsAsFile()) return;

                auto& deck = engine.getVirtualDeck(deckNum);
                if (deck.loadFile(file))
                {
                    engine.setVirtualDeckActive(deckNum, true);
                    updateDisplay();
                }
            });
    };

    // ── EJECT button ──
    addAndMakeVisible(ejectBtn);
    ejectBtn.setColour(juce::TextButton::buttonColourId, Theme::bg3);
    ejectBtn.setColour(juce::TextButton::textColourOffId, Theme::red);
    ejectBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).eject();
        engine.setVirtualDeckActive(deckNum, false);
        updateDisplay();
    };

    // ── HW toggle button ──
    addAndMakeVisible(hwBtn);
    hwBtn.setColour(juce::TextButton::buttonColourId, Theme::bg3);
    hwBtn.setColour(juce::TextButton::textColourOffId, Theme::tx3);
    hwBtn.onClick = [this]
    {
        bool newHW = !engine.isHWMode(deckNum);
        engine.setHWMode(deckNum, newHW);
        hwBtn.setButtonText(newHW ? "HW" : "VIR");
        hwBtn.setColour(juce::TextButton::textColourOffId,
            newHW ? Theme::pur : Theme::tx3);
        updateDisplay();
    };

    // ── Volume slider ──
    addAndMakeVisible(volumeSlider);
    volumeSlider.setRange(0.0, 1.0, 0.01);
    volumeSlider.setValue(1.0);
    volumeSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    volumeSlider.setTextBoxStyle(juce::Slider::NoTextBox, true, 0, 0);
    volumeSlider.setColour(juce::Slider::trackColourId, Theme::bg4);
    volumeSlider.setColour(juce::Slider::thumbColourId, Theme::tx3);
    volumeSlider.onValueChange = [this]
    {
        engine.getVirtualDeck(deckNum).setVolume((float)volumeSlider.getValue());
    };
}

void DeckPanel::paint(juce::Graphics& g)
{
    auto bounds = getLocalBounds().toFloat();
    bool isHW = engine.isHWMode(deckNum);

    // ── Card background ──
    g.setColour(Theme::bg2);
    g.fillRoundedRectangle(bounds, 8.0f);

    // ── Border glow based on state ──
    juce::Colour borderCol = Theme::bdr2;
    juce::Colour glowCol = juce::Colours::transparentBlack;

    if (isHW)
    {
        borderCol = Theme::pur.withAlpha(0.5f);
        if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
        {
            borderCol = Theme::grn.withAlpha(0.6f);
            glowCol = Theme::grn.withAlpha(0.08f);
        }
    }
    else
    {
        switch (displayState)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                borderCol = Theme::grn.withAlpha(0.6f);
                glowCol = Theme::grn.withAlpha(0.08f);
                break;
            case PlayState::CUED: case PlayState::CUEING:
                borderCol = Theme::ylw.withAlpha(0.5f);
                glowCol = Theme::ylw.withAlpha(0.05f);
                break;
            case PlayState::PAUSED:
                borderCol = Theme::org.withAlpha(0.4f);
                break;
            default: break;
        }
    }

    // Glow fill
    if (!glowCol.isTransparent())
    {
        g.setColour(glowCol);
        g.fillRoundedRectangle(bounds, 8.0f);
    }

    // Border
    g.setColour(borderCol);
    g.drawRoundedRectangle(bounds.reduced(0.5f), 8.0f, 1.5f);

    // ── Header bar ──
    auto headerArea = bounds.removeFromTop(32.0f).reduced(10.0f, 4.0f);

    // Player number
    g.setColour(Theme::blu);
    g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText("PLAYER " + juce::String(deckNum + 1), headerArea, juce::Justification::centredLeft);

    // State badge
    juce::String badgeText;
    juce::Colour badgeCol;
    if (isHW)
    {
        badgeText = "HW";
        badgeCol = Theme::pur;
        if (displayState == PlayState::PLAYING) { badgeText = "HW PLAY"; badgeCol = Theme::grn; }
    }
    else
    {
        auto& deck = engine.getVirtualDeck(deckNum);
        if (!deck.isLoaded())
        {
            badgeText = "EMPTY";
            badgeCol = Theme::tx4;
        }
        else
        {
            badgeText = playStateToString(displayState);
            switch (displayState)
            {
                case PlayState::PLAYING: case PlayState::LOOPING:
                    badgeCol = Theme::grn; break;
                case PlayState::CUED: case PlayState::CUEING:
                    badgeCol = Theme::ylw; break;
                case PlayState::PAUSED:
                    badgeCol = Theme::org; break;
                case PlayState::STOPPED:
                    badgeCol = Theme::red; break;
                default:
                    badgeCol = Theme::tx4; break;
            }
        }
    }

    // Draw badge
    auto badgeW = juce::jmax(50.0f, (float)badgeText.length() * 8.0f + 16.0f);
    auto badgeRect = juce::Rectangle<float>(
        headerArea.getRight() - badgeW, headerArea.getY(), badgeW, headerArea.getHeight());
    g.setColour(badgeCol.withAlpha(0.15f));
    g.fillRoundedRectangle(badgeRect, 4.0f);
    g.setColour(badgeCol);
    g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
    g.drawText(badgeText, badgeRect, juce::Justification::centred);

    // ── Separator line ──
    g.setColour(Theme::bdr);
    g.drawHorizontalLine(32, 8.0f, getWidth() - 8.0f);

    // ── Beat phasor (4 segments) ──
    auto area = getLocalBounds().toFloat();
    float phasorY = area.getBottom() - 98.0f;
    float phasorH = 6.0f;
    float segW = (getWidth() - 28.0f) / 4.0f;

    for (int i = 0; i < 4; i++)
    {
        auto segRect = juce::Rectangle<float>(
            10.0f + i * (segW + 2.0f), phasorY, segW, phasorH);

        int curBeat = beatPhase / 64;  // 0-3
        bool active = (i <= curBeat) && (displayState == PlayState::PLAYING ||
                                          displayState == PlayState::LOOPING);

        g.setColour(active ? Theme::grn.withAlpha(0.7f) : Theme::bg4);
        g.fillRoundedRectangle(segRect, 2.0f);
    }
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(10);
    area.removeFromTop(36); // Header

    // Track name
    titleLabel.setBounds(area.removeFromTop(20));
    // Artist
    artistLabel.setBounds(area.removeFromTop(16));

    area.removeFromTop(4);

    // BPM + Time row
    auto infoRow = area.removeFromTop(18);
    bpmLabel.setBounds(infoRow.removeFromLeft(100));
    timeLabel.setBounds(infoRow);

    area.removeFromTop(4);

    // Beat phasor space
    area.removeFromBottom(8);

    // Bottom controls area
    auto bottomRow = area.removeFromBottom(28);
    int bw3 = (bottomRow.getWidth() - 8) / 3;
    loadBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    hwBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    ejectBtn.setBounds(bottomRow);

    // Volume row
    area.removeFromBottom(4);
    auto volRow = area.removeFromBottom(20);
    volumeSlider.setBounds(volRow);

    area.removeFromBottom(4);

    // Beat phasor reserved (painted directly)
    area.removeFromBottom(12);

    // CUE + PLAY buttons
    auto btnRow = area.removeFromBottom(36);
    int halfW = (btnRow.getWidth() - 8) / 2;
    cueBtn.setBounds(btnRow.removeFromLeft(halfW));
    btnRow.removeFromLeft(8);
    playBtn.setBounds(btnRow);
}

void DeckPanel::updateDisplay()
{
    bool isHW = engine.isHWMode(deckNum);

    if (isHW)
    {
        // Hardware mode - read from layer state
        auto* ls = engine.getLayerState(deckNum);
        if (ls)
        {
            displayState = ls->state;
            beatPhase = ls->beatPhase;
            titleLabel.setText(ls->trackName.isEmpty() ? "CDJ-" + juce::String(deckNum + 1) : ls->trackName,
                              juce::dontSendNotification);
            artistLabel.setText(ls->artistName.isEmpty() ? ls->deviceName : ls->artistName,
                               juce::dontSendNotification);
            bpmLabel.setText(juce::String(ls->bpm, 1) + " BPM", juce::dontSendNotification);
            timeLabel.setText(formatTime(ls->timecodeMs) + " / " + formatTime(ls->totalLengthMs),
                             juce::dontSendNotification);
        }
        else
        {
            displayState = PlayState::IDLE;
            titleLabel.setText("CDJ-" + juce::String(deckNum + 1) + " (waiting...)",
                              juce::dontSendNotification);
            artistLabel.setText("Hardware Mode", juce::dontSendNotification);
            bpmLabel.setText("--- BPM", juce::dontSendNotification);
            timeLabel.setText("--:--.--- / --:--.---", juce::dontSendNotification);
        }

        // Disable virtual controls in HW mode
        loadBtn.setEnabled(false);
        ejectBtn.setEnabled(false);
        playBtn.setEnabled(false);
        cueBtn.setEnabled(false);
        volumeSlider.setEnabled(false);
    }
    else
    {
        // Virtual mode
        auto& deck = engine.getVirtualDeck(deckNum);

        loadBtn.setEnabled(true);
        ejectBtn.setEnabled(true);
        playBtn.setEnabled(true);
        cueBtn.setEnabled(true);
        volumeSlider.setEnabled(true);

        if (deck.isLoaded())
        {
            displayState = deck.getState();
            beatPhase = deck.getBeatPhase();
            titleLabel.setText(deck.getTitle(), juce::dontSendNotification);
            artistLabel.setText(deck.getArtist().isEmpty() ? "Virtual Deck" : deck.getArtist(),
                               juce::dontSendNotification);
            bpmLabel.setText(juce::String(deck.getBpm(), 1) + " BPM", juce::dontSendNotification);
            timeLabel.setText(formatTime(deck.getPositionMs()) + " / " + formatTime(deck.getDurationMs()),
                             juce::dontSendNotification);
        }
        else
        {
            displayState = PlayState::IDLE;
            beatPhase = 0;
            titleLabel.setText("Empty", juce::dontSendNotification);
            artistLabel.setText("Load a track", juce::dontSendNotification);
            bpmLabel.setText("", juce::dontSendNotification);
            timeLabel.setText("", juce::dontSendNotification);
        }
    }

    // ── Update button colors ──
    // CUE: yellow when active
    bool cueLit = (displayState == PlayState::CUED || displayState == PlayState::CUEING);
    cueBtn.setColour(juce::TextButton::buttonColourId,
        cueLit ? Theme::ylw2.withAlpha(0.3f) : Theme::bg4);
    cueBtn.setColour(juce::TextButton::textColourOffId,
        cueLit ? Theme::ylw : juce::Colour(0x80ffd16d));

    // PLAY: green when playing
    bool playLit = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);
    playBtn.setColour(juce::TextButton::buttonColourId,
        playLit ? Theme::grn2.withAlpha(0.3f) : Theme::bg4);
    playBtn.setColour(juce::TextButton::textColourOffId,
        playLit ? Theme::grn : juce::Colour(0x805af0b3));

    // HW button
    hwBtn.setButtonText(isHW ? "HW" : "VIR");
    hwBtn.setColour(juce::TextButton::textColourOffId,
        isHW ? Theme::pur : Theme::tx3);

    repaint();
}

// ═══════════════════════════════════════════
// ── MainComponent ──────────────────────────
// ═══════════════════════════════════════════

MainComponent::MainComponent()
{
    // ── Header ──
    addAndMakeVisible(startBtn);
    startBtn.setColour(juce::TextButton::buttonColourId, Theme::grn2.withAlpha(0.2f));
    startBtn.setColour(juce::TextButton::textColourOffId, Theme::grn);
    startBtn.onClick = [this]
    {
        if (engine.isRunning())
        {
            engine.stop();
            startBtn.setButtonText("START BRIDGE");
            startBtn.setColour(juce::TextButton::buttonColourId, Theme::grn2.withAlpha(0.2f));
            startBtn.setColour(juce::TextButton::textColourOffId, Theme::grn);
        }
        else
        {
            if (engine.start())
            {
                startBtn.setButtonText("STOP BRIDGE");
                startBtn.setColour(juce::TextButton::buttonColourId, Theme::red.withAlpha(0.2f));
                startBtn.setColour(juce::TextButton::textColourOffId, Theme::red);
            }
        }
    };

    addAndMakeVisible(statusDotLabel);
    statusDotLabel.setFont(juce::FontOptions(10.0f));
    statusDotLabel.setJustificationType(juce::Justification::centred);

    addAndMakeVisible(statusTextLabel);
    statusTextLabel.setFont(juce::FontOptions(13.0f));
    statusTextLabel.setColour(juce::Label::textColourId, Theme::tx2);
    statusTextLabel.setText("READY", juce::dontSendNotification);

    addAndMakeVisible(versionLabel);
    versionLabel.setText("v1.0.0", juce::dontSendNotification);
    versionLabel.setColour(juce::Label::textColourId, Theme::tx4);
    versionLabel.setFont(juce::FontOptions(11.0f));
    versionLabel.setJustificationType(juce::Justification::centredRight);

    // ── Tab Bar ──
    const char* tabNames[] = { "LINK", "PRO DJ LINK", "TCNet", "SETTINGS" };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setButtonText(tabNames[i]);
        addAndMakeVisible(tabBtns[(size_t)i]);
        tabBtns[(size_t)i].setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
        tabBtns[(size_t)i].setColour(juce::TextButton::textColourOffId, Theme::tx3);
        tabBtns[(size_t)i].onClick = [this, i]
        {
            activeTab = (Tab)i;
            for (int j = 0; j < 4; j++)
                tabBtns[(size_t)j].setColour(juce::TextButton::textColourOffId,
                    j == i ? Theme::grn : Theme::tx3);
            repaint();
        };
    }
    tabBtns[0].setColour(juce::TextButton::textColourOffId, Theme::grn);

    // ── Status Badges ──
    auto setupBadge = [this](juce::Label& badge, const juce::String& text, juce::Colour col)
    {
        addAndMakeVisible(badge);
        badge.setText(text, juce::dontSendNotification);
        badge.setFont(juce::FontOptions(11.0f));
        badge.setColour(juce::Label::textColourId, col);
        badge.setJustificationType(juce::Justification::centredLeft);
    };

    setupBadge(tcnetBadge,  "TCNet: OFFLINE", Theme::red);
    setupBadge(arenaBadge,  "Arena: 0",       Theme::blu);
    setupBadge(deckBadge,   "Decks: 0",       Theme::tx3);
    setupBadge(uptimeBadge, "Uptime: 00:00:00", Theme::tx3);

    // ── Mode Bar ──
    addAndMakeVisible(virtualBtn);
    virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::grn2.withAlpha(0.15f));
    virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::grn);
    virtualBtn.onClick = [this]
    {
        globalHWMode = false;
        virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::grn2.withAlpha(0.15f));
        virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::grn);
        hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::bg4);
        hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::tx3);
        repaint();
    };

    addAndMakeVisible(hwModeBtn);
    hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::bg4);
    hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::tx3);
    hwModeBtn.onClick = [this]
    {
        globalHWMode = true;
        hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::pur.withAlpha(0.15f));
        hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::pur);
        virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::bg4);
        virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::tx3);
        repaint();
    };

    addAndMakeVisible(addDeckBtn);
    addDeckBtn.setColour(juce::TextButton::buttonColourId, Theme::bg3);
    addDeckBtn.setColour(juce::TextButton::textColourOffId, Theme::grn);
    addDeckBtn.onClick = [this] { addDeck(); };

    // ── Bottom Bar ──
    addAndMakeVisible(packetLabel);
    packetLabel.setFont(juce::FontOptions(11.0f));
    packetLabel.setColour(juce::Label::textColourId, Theme::tx4);
    packetLabel.setText("TCNet TX: 0", juce::dontSendNotification);
    packetLabel.setJustificationType(juce::Justification::centredRight);

    // ── Audio output ──
    setAudioChannels(0, 2);

    setSize(1040, 720);
    startTimerHz(20);
}

MainComponent::~MainComponent()
{
    stopTimer();
    shutdownAudio();
    engine.stop();
}

void MainComponent::addDeck()
{
    if (visibleDecks >= 8) return;

    int idx = visibleDecks;
    if (!deckPanels[(size_t)idx])
    {
        deckPanels[(size_t)idx] = std::make_unique<DeckPanel>(idx, engine);
        addAndMakeVisible(deckPanels[(size_t)idx].get());
    }
    else
    {
        deckPanels[(size_t)idx]->setVisible(true);
    }
    visibleDecks++;
    layoutDecks();

    addDeckBtn.setButtonText("+ DECK (" + juce::String(visibleDecks) + "/8)");
    if (visibleDecks >= 8)
        addDeckBtn.setEnabled(false);
}

// ── Audio ────────────────────────────────────
void MainComponent::prepareToPlay(int /*samplesPerBlockExpected*/, double sampleRate)
{
    currentSampleRate = sampleRate;
    for (int i = 0; i < 8; i++)
        engine.getVirtualDeck(i).setSampleRate(sampleRate);
}

void MainComponent::getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill)
{
    bufferToFill.clearActiveBufferRegion();

    auto* leftOut  = bufferToFill.buffer->getWritePointer(0, bufferToFill.startSample);
    auto* rightOut = bufferToFill.buffer->getWritePointer(
        bufferToFill.buffer->getNumChannels() > 1 ? 1 : 0, bufferToFill.startSample);

    int numSamples = bufferToFill.numSamples;

    std::vector<float> tmpL((size_t)numSamples, 0.0f);
    std::vector<float> tmpR((size_t)numSamples, 0.0f);

    for (int d = 0; d < 8; d++)
    {
        if (!engine.isVirtualDeckActive(d)) continue;
        if (engine.isHWMode(d)) continue;

        auto& deck = engine.getVirtualDeck(d);
        if (!deck.isLoaded()) continue;

        deck.getNextAudioBlock(tmpL.data(), tmpR.data(), numSamples);

        for (int i = 0; i < numSamples; i++)
        {
            leftOut[i]  += tmpL[(size_t)i];
            rightOut[i] += tmpR[(size_t)i];
        }
    }
}

void MainComponent::releaseResources() {}

// ── Paint ────────────────────────────────────
void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(Theme::bg);

    int w = getWidth();

    // ── Header bar (52px) ──
    g.setColour(Theme::bgLowest);
    g.fillRect(0, 0, w, 52);

    // B+ logo badge
    g.setGradientFill(juce::ColourGradient(
        Theme::grn, 16.0f, 12.0f,
        Theme::grn2, 40.0f, 40.0f, false));
    g.fillRoundedRectangle(10.0f, 12.0f, 28.0f, 28.0f, 6.0f);
    g.setColour(Theme::bgLowest);
    g.setFont(juce::FontOptions(16.0f, juce::Font::bold));
    g.drawText("B+", 10, 12, 28, 28, juce::Justification::centred);

    // Title
    g.setColour(Theme::tx);
    g.setFont(juce::FontOptions(16.0f, juce::Font::bold));
    g.drawText("BRIDGE+", 44, 10, 100, 18, juce::Justification::centredLeft);
    g.setColour(Theme::tx3);
    g.setFont(juce::FontOptions(10.0f));
    g.drawText("PRO DJ LINK", 44, 28, 100, 14, juce::Justification::centredLeft);

    // Status dot
    juce::Colour dotCol = engine.isRunning() ? Theme::grn : Theme::tx4;
    g.setColour(dotCol);
    g.fillEllipse(160.0f, 22.0f, 8.0f, 8.0f);

    // Separator line
    g.setColour(Theme::bdr2);
    g.drawHorizontalLine(52, 0, (float)w);

    // ── Tab bar (36px) ──
    g.setColour(Theme::bg2);
    g.fillRect(0, 52, w, 36);

    // Active tab underline
    if ((int)activeTab < 4)
    {
        auto& btn = tabBtns[(size_t)activeTab];
        g.setColour(Theme::grn);
        g.fillRect(btn.getX(), 86, btn.getWidth(), 2);
    }

    g.setColour(Theme::bdr);
    g.drawHorizontalLine(88, 0, (float)w);

    // ── Status bar (28px) ──
    g.setColour(Theme::bg3);
    g.fillRect(0, 88, w, 28);
    g.setColour(Theme::bdr);
    g.drawHorizontalLine(116, 0, (float)w);

    // ── Mode bar (36px) ──
    g.setColour(Theme::bg2);
    g.fillRect(0, 116, w, 36);

    // "DECK MODE" label
    g.setColour(Theme::tx3);
    g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
    g.drawText("DECK MODE", 10, 116, 80, 36, juce::Justification::centredLeft);

    g.setColour(Theme::bdr);
    g.drawHorizontalLine(152, 0, (float)w);

    // ── Empty state ──
    if (visibleDecks == 0)
    {
        g.setColour(Theme::tx4);
        g.setFont(juce::FontOptions(16.0f));
        g.drawText("Click \"+ DECK\" to add a virtual deck",
                   getLocalBounds().withTrimmedTop(152).withTrimmedBottom(28),
                   juce::Justification::centred);
    }

    // ── Bottom bar (28px) ──
    int bh = getHeight();
    g.setColour(Theme::bgLowest);
    g.fillRect(0, bh - 28, w, 28);
    g.setColour(Theme::bdr);
    g.drawHorizontalLine(bh - 28, 0, (float)w);
}

void MainComponent::resized()
{
    int w = getWidth();

    // ── Header ──
    statusTextLabel.setBounds(172, 16, 100, 20);
    startBtn.setBounds(w - 150, 12, 130, 28);
    versionLabel.setBounds(w - 290, 12, 130, 28);

    // ── Tab bar ──
    int tabX = 10;
    int tabWidths[] = { 50, 100, 60, 80 };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setBounds(tabX, 54, tabWidths[i], 32);
        tabX += tabWidths[i] + 4;
    }

    // ── Status bar ──
    int sx = 12;
    tcnetBadge.setBounds(sx, 90, 110, 24);  sx += 114;
    arenaBadge.setBounds(sx, 90, 80, 24);   sx += 84;
    deckBadge.setBounds(sx, 90, 80, 24);    sx += 84;
    uptimeBadge.setBounds(sx, 90, 140, 24);

    // ── Mode bar ──
    virtualBtn.setBounds(92, 120, 80, 28);
    hwModeBtn.setBounds(176, 120, 90, 28);
    addDeckBtn.setBounds(w - 130, 120, 120, 28);

    // ── Bottom bar ──
    packetLabel.setBounds(w - 200, getHeight() - 26, 190, 24);

    layoutDecks();
}

void MainComponent::layoutDecks()
{
    if (visibleDecks == 0) return;

    // Deck area: below mode bar (152) and above bottom bar (28)
    auto area = getLocalBounds();
    area.removeFromTop(156);
    area.removeFromBottom(28);
    area = area.reduced(8, 4);

    if (visibleDecks == 1)
    {
        deckPanels[0]->setBounds(area.withWidth(area.getWidth() / 2));
    }
    else if (visibleDecks == 2)
    {
        int halfW = (area.getWidth() - 8) / 2;
        deckPanels[0]->setBounds(area.getX(), area.getY(), halfW, area.getHeight());
        deckPanels[1]->setBounds(area.getX() + halfW + 8, area.getY(), halfW, area.getHeight());
    }
    else
    {
        int cols = 2;
        int rows = (visibleDecks + 1) / 2;
        int cellW = (area.getWidth() - 8) / cols;
        int cellH = (area.getHeight() - (rows - 1) * 8) / rows;

        for (int i = 0; i < visibleDecks; i++)
        {
            int col = i % 2;
            int row = i / 2;
            if (deckPanels[(size_t)i])
                deckPanels[(size_t)i]->setBounds(
                    area.getX() + col * (cellW + 8),
                    area.getY() + row * (cellH + 8),
                    cellW, cellH);
        }
    }
}

void MainComponent::timerCallback()
{
    // Update status
    if (engine.isRunning())
    {
        statusTextLabel.setText("RUNNING", juce::dontSendNotification);
        statusTextLabel.setColour(juce::Label::textColourId, Theme::grn);
        tcnetBadge.setText("TCNet: ONLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, Theme::blu);
        arenaBadge.setText("Arena: " + juce::String(engine.getNodeCount()),
                          juce::dontSendNotification);
        uptimeBadge.setText("Uptime: " + formatUptime(engine.getUptimeSeconds()),
                           juce::dontSendNotification);
        packetLabel.setText("TCNet TX: " + juce::String(engine.getPacketCount()),
                          juce::dontSendNotification);
    }
    else
    {
        statusTextLabel.setText("READY", juce::dontSendNotification);
        statusTextLabel.setColour(juce::Label::textColourId, Theme::tx3);
        tcnetBadge.setText("TCNet: OFFLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, Theme::red);
    }

    // Active deck count
    int activeCount = 0;
    for (int i = 0; i < 8; i++)
        if (engine.isVirtualDeckActive(i) || engine.isHWMode(i)) activeCount++;
    deckBadge.setText("Decks: " + juce::String(activeCount), juce::dontSendNotification);

    // Update deck panels
    for (int i = 0; i < visibleDecks; i++)
        if (deckPanels[(size_t)i])
            deckPanels[(size_t)i]->updateDisplay();
}
