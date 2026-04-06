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

static juce::String formatTimecode(float ms, int fps = 25)
{
    if (ms <= 0) return "00:00:00:00";
    int totalMs = (int)ms;
    int h = totalMs / 3600000;
    int m = (totalMs % 3600000) / 60000;
    int s = (totalMs % 60000) / 1000;
    int f = (int)((totalMs % 1000) / (1000.0f / fps));
    return juce::String::formatted("%02d:%02d:%02d:%02d", h, m, s, f);
}

// ═══════════════════════════════════════════════
// ── DeckPanel ──────────────────────────────────
// ═══════════════════════════════════════════════

DeckPanel::DeckPanel(int num, BridgeEngine& eng)
    : deckNum(num), engine(eng)
{
    auto setupLabel = [this](juce::Label& label, float fontSize, juce::Colour col)
    {
        addAndMakeVisible(label);
        label.setFont(juce::FontOptions(fontSize));
        label.setColour(juce::Label::textColourId, col);
        label.setJustificationType(juce::Justification::centredLeft);
    };

    setupLabel(titleLabel,  14.0f, Theme::onSurface);
    setupLabel(artistLabel, 11.0f, Theme::onSurfVar);
    setupLabel(bpmLabel,    12.0f, Theme::primaryCont);
    setupLabel(timeLabel,   12.0f, Theme::onSurfVar);

    titleLabel.setText("Empty", juce::dontSendNotification);
    artistLabel.setText("Load a track", juce::dontSendNotification);

    // CUE (yellow accent)
    addAndMakeVisible(cueBtn);
    cueBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
    cueBtn.setColour(juce::TextButton::textColourOffId, Theme::ylw.withAlpha(0.5f));
    cueBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).cue();
    };

    // PLAY (green)
    addAndMakeVisible(playBtn);
    playBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
    playBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont.withAlpha(0.5f));
    playBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).playPause();
    };

    // LOAD
    addAndMakeVisible(loadBtn);
    loadBtn.setColour(juce::TextButton::buttonColourId, Theme::surfContHigh);
    loadBtn.setColour(juce::TextButton::textColourOffId, Theme::onSurfVar);
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

    // EJECT
    addAndMakeVisible(ejectBtn);
    ejectBtn.setColour(juce::TextButton::buttonColourId, Theme::surfContHigh);
    ejectBtn.setColour(juce::TextButton::textColourOffId, Theme::error);
    ejectBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).eject();
        engine.setVirtualDeckActive(deckNum, false);
        updateDisplay();
    };

    // HW toggle
    addAndMakeVisible(hwBtn);
    hwBtn.setColour(juce::TextButton::buttonColourId, Theme::surfContHigh);
    hwBtn.setColour(juce::TextButton::textColourOffId, Theme::onSurfVar);
    hwBtn.onClick = [this]
    {
        bool newHW = !engine.isHWMode(deckNum);
        engine.setHWMode(deckNum, newHW);
        hwBtn.setButtonText(newHW ? "HW" : "VIR");
        hwBtn.setColour(juce::TextButton::textColourOffId,
            newHW ? Theme::tertiaryAccent : Theme::onSurfVar);
        updateDisplay();
    };

    // Volume
    addAndMakeVisible(volumeSlider);
    volumeSlider.setRange(0.0, 1.0, 0.01);
    volumeSlider.setValue(1.0);
    volumeSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    volumeSlider.setTextBoxStyle(juce::Slider::NoTextBox, true, 0, 0);
    volumeSlider.setColour(juce::Slider::trackColourId, Theme::surfVariant);
    volumeSlider.setColour(juce::Slider::thumbColourId, Theme::outline);
    volumeSlider.onValueChange = [this]
    {
        engine.getVirtualDeck(deckNum).setVolume((float)volumeSlider.getValue());
    };
}

void DeckPanel::paint(juce::Graphics& g)
{
    auto bounds = getLocalBounds().toFloat();
    bool isHW = engine.isHWMode(deckNum);

    // Card background
    g.setColour(Theme::surfContHigh);
    g.fillRoundedRectangle(bounds, 8.0f);

    // Border + glow
    juce::Colour borderCol = Theme::outlineVar;
    juce::Colour glowCol = juce::Colours::transparentBlack;

    if (isHW)
    {
        borderCol = Theme::tertiaryAccent.withAlpha(0.5f);
        if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
        {
            borderCol = Theme::primaryCont.withAlpha(0.6f);
            glowCol = Theme::primaryCont.withAlpha(0.06f);
        }
    }
    else
    {
        switch (displayState)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                borderCol = Theme::primaryCont.withAlpha(0.6f);
                glowCol = Theme::primaryCont.withAlpha(0.06f);
                break;
            case PlayState::CUED: case PlayState::CUEING:
                borderCol = Theme::ylw.withAlpha(0.5f);
                glowCol = Theme::ylw.withAlpha(0.04f);
                break;
            case PlayState::PAUSED:
                borderCol = Theme::org.withAlpha(0.4f);
                break;
            default: break;
        }
    }

    if (!glowCol.isTransparent())
    {
        g.setColour(glowCol);
        g.fillRoundedRectangle(bounds, 8.0f);
    }

    g.setColour(borderCol);
    g.drawRoundedRectangle(bounds.reduced(0.5f), 8.0f, 1.5f);

    // ── Header row ──
    auto hdr = bounds.removeFromTop(30.0f).reduced(12.0f, 4.0f);

    // Player number
    g.setColour(Theme::secondary);
    g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
    g.drawText("PLAYER " + juce::String(deckNum + 1), hdr, juce::Justification::centredLeft);

    // State badge
    juce::String badge;
    juce::Colour badgeCol;
    if (isHW)
    {
        badge = (displayState == PlayState::PLAYING) ? "HW PLAY" : "HW";
        badgeCol = (displayState == PlayState::PLAYING) ? Theme::primaryCont : Theme::tertiaryAccent;
    }
    else
    {
        auto& deck = engine.getVirtualDeck(deckNum);
        if (!deck.isLoaded()) { badge = "EMPTY"; badgeCol = Theme::outline; }
        else
        {
            badge = playStateToString(displayState);
            switch (displayState)
            {
                case PlayState::PLAYING: case PlayState::LOOPING:
                    badgeCol = Theme::primaryCont; break;
                case PlayState::CUED: case PlayState::CUEING:
                    badgeCol = Theme::ylw; break;
                case PlayState::PAUSED:
                    badgeCol = Theme::org; break;
                case PlayState::STOPPED:
                    badgeCol = Theme::error; break;
                default: badgeCol = Theme::outline; break;
            }
        }
    }

    float bw = (float)badge.length() * 7.5f + 14.0f;
    auto badgeRect = juce::Rectangle<float>(hdr.getRight() - bw, hdr.getY(), bw, hdr.getHeight());
    g.setColour(badgeCol.withAlpha(0.15f));
    g.fillRoundedRectangle(badgeRect, 4.0f);
    g.setColour(badgeCol);
    g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
    g.drawText(badge, badgeRect, juce::Justification::centred);

    // Flags (sync, master, on-air)
    if (isHW)
    {
        int flagX = (int)badgeRect.getX() - 8;
        int flagY = (int)hdr.getY();
        int flagH = (int)hdr.getHeight();
        if (onAirFlag)
        {
            g.setColour(Theme::primaryCont);
            g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
            g.drawText("AIR", flagX - 24, flagY, 22, flagH, juce::Justification::centredRight);
            flagX -= 28;
        }
        if (masterFlag)
        {
            g.setColour(Theme::ylw);
            g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
            g.drawText("MST", flagX - 24, flagY, 22, flagH, juce::Justification::centredRight);
            flagX -= 28;
        }
        if (syncFlag)
        {
            g.setColour(Theme::secondary);
            g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
            g.drawText("SYN", flagX - 24, flagY, 22, flagH, juce::Justification::centredRight);
        }
    }

    // Separator
    g.setColour(Theme::outlineVar);
    g.drawHorizontalLine(30, 8.0f, getWidth() - 8.0f);

    // ── Beat phasor ──
    auto area = getLocalBounds().toFloat();
    float phasorY = area.getBottom() - 94.0f;
    float phasorH = 5.0f;
    float totalW = getWidth() - 24.0f;
    float segW = (totalW - 6.0f) / 4.0f;

    for (int i = 0; i < 4; i++)
    {
        auto seg = juce::Rectangle<float>(12.0f + i * (segW + 2.0f), phasorY, segW, phasorH);
        int curBeat = beatPhase / 64;
        bool active = (i <= curBeat) && (displayState == PlayState::PLAYING ||
                                          displayState == PlayState::LOOPING);
        g.setColour(active ? Theme::primaryCont.withAlpha(0.7f) : Theme::surfVariant);
        g.fillRoundedRectangle(seg, 2.0f);
    }
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(12);
    area.removeFromTop(34); // Header

    titleLabel.setBounds(area.removeFromTop(18));
    artistLabel.setBounds(area.removeFromTop(14));
    area.removeFromTop(4);

    auto infoRow = area.removeFromTop(16);
    bpmLabel.setBounds(infoRow.removeFromLeft(90));
    timeLabel.setBounds(infoRow);

    area.removeFromTop(4);

    // Bottom controls
    area.removeFromBottom(6);
    auto bottomRow = area.removeFromBottom(26);
    int bw3 = (bottomRow.getWidth() - 8) / 3;
    loadBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    hwBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    ejectBtn.setBounds(bottomRow);

    area.removeFromBottom(4);
    volumeSlider.setBounds(area.removeFromBottom(18));
    area.removeFromBottom(4);

    // Beat phasor space (painted)
    area.removeFromBottom(12);

    // CUE + PLAY
    auto btnRow = area.removeFromBottom(34);
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
            titleLabel.setText("CDJ-" + juce::String(deckNum + 1) + " (waiting...)", juce::dontSendNotification);
            artistLabel.setText("Hardware Mode", juce::dontSendNotification);
            bpmLabel.setText("--- BPM", juce::dontSendNotification);
            timeLabel.setText("--:--.--- / --:--.---", juce::dontSendNotification);
        }

        loadBtn.setEnabled(false);
        ejectBtn.setEnabled(false);
        playBtn.setEnabled(false);
        cueBtn.setEnabled(false);
        volumeSlider.setEnabled(false);
    }
    else
    {
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

    // Button color updates
    bool cueLit = (displayState == PlayState::CUED || displayState == PlayState::CUEING);
    cueBtn.setColour(juce::TextButton::buttonColourId,
        cueLit ? Theme::ylw2.withAlpha(0.25f) : Theme::surfCont);
    cueBtn.setColour(juce::TextButton::textColourOffId,
        cueLit ? Theme::ylw : Theme::ylw.withAlpha(0.5f));

    bool playLit = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);
    playBtn.setColour(juce::TextButton::buttonColourId,
        playLit ? Theme::primaryDim.withAlpha(0.25f) : Theme::surfCont);
    playBtn.setColour(juce::TextButton::textColourOffId,
        playLit ? Theme::primaryCont : Theme::primaryCont.withAlpha(0.5f));

    hwBtn.setButtonText(isHW ? "HW" : "VIR");
    hwBtn.setColour(juce::TextButton::textColourOffId,
        isHW ? Theme::tertiaryAccent : Theme::onSurfVar);

    repaint();
}

// ═══════════════════════════════════════════════
// ── OutputLayerPanel ───────────────────────────
// ═══════════════════════════════════════════════

OutputLayerPanel::OutputLayerPanel(const juce::String& name, juce::Colour accent,
                                   BridgeEngine& eng, int idx)
    : layerName(name), accentCol(accent), engine(eng), layerIndex(idx)
{
    addAndMakeVisible(timecodeLabel);
    timecodeLabel.setFont(juce::FontOptions(20.0f));
    timecodeLabel.setColour(juce::Label::textColourId, Theme::onSurface);
    timecodeLabel.setText("00:00:00:00", juce::dontSendNotification);
    timecodeLabel.setJustificationType(juce::Justification::centred);

    addAndMakeVisible(sourceSelector);
    sourceSelector.setColour(juce::ComboBox::backgroundColourId, Theme::surfCont);
    sourceSelector.setColour(juce::ComboBox::textColourId, Theme::onSurfVar);
    sourceSelector.setColour(juce::ComboBox::outlineColourId, Theme::outlineVar);
    sourceSelector.addItem("None", 1);
    for (int i = 0; i < 8; i++)
        sourceSelector.addItem("Layer " + juce::String(i + 1), i + 2);
    sourceSelector.setSelectedId(layerIndex + 2);
}

void OutputLayerPanel::paint(juce::Graphics& g)
{
    auto bounds = getLocalBounds().toFloat();

    g.setColour(Theme::surfContHigh);
    g.fillRoundedRectangle(bounds, 8.0f);

    g.setColour(accentCol.withAlpha(0.3f));
    g.drawRoundedRectangle(bounds.reduced(0.5f), 8.0f, 1.5f);

    // Color indicator + name
    g.setColour(accentCol);
    g.fillRoundedRectangle(12.0f, 10.0f, 4.0f, 20.0f, 2.0f);

    g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
    g.drawText("Layer " + layerName, 22, 8, 100, 24, juce::Justification::centredLeft);
}

void OutputLayerPanel::resized()
{
    auto area = getLocalBounds().reduced(12);
    area.removeFromTop(30);

    timecodeLabel.setBounds(area.removeFromTop(28));
    area.removeFromTop(6);
    sourceSelector.setBounds(area.removeFromTop(24));
}

void OutputLayerPanel::updateDisplay()
{
    int srcIdx = sourceSelector.getSelectedId() - 2;
    if (srcIdx >= 0 && srcIdx < 8)
    {
        auto* ls = engine.getLayerState(srcIdx);
        if (ls)
            timecodeLabel.setText(formatTimecode(ls->timecodeMs), juce::dontSendNotification);
        else
            timecodeLabel.setText("00:00:00:00", juce::dontSendNotification);
    }
    else
    {
        timecodeLabel.setText("00:00:00:00", juce::dontSendNotification);
    }
}

// ═══════════════════════════════════════════════
// ── MainComponent ──────────────────────────────
// ═══════════════════════════════════════════════

MainComponent::MainComponent()
{
    // ── Header ──
    addAndMakeVisible(startBtn);
    startBtn.setColour(juce::TextButton::buttonColourId, Theme::primaryDim.withAlpha(0.15f));
    startBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont);
    startBtn.onClick = [this]
    {
        if (engine.isRunning())
        {
            engine.stop();
            startBtn.setButtonText("START BRIDGE");
            startBtn.setColour(juce::TextButton::buttonColourId, Theme::primaryDim.withAlpha(0.15f));
            startBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont);
        }
        else
        {
            if (engine.start())
            {
                startBtn.setButtonText("STOP BRIDGE");
                startBtn.setColour(juce::TextButton::buttonColourId, Theme::error.withAlpha(0.15f));
                startBtn.setColour(juce::TextButton::textColourOffId, Theme::error);
            }
        }
    };

    addAndMakeVisible(statusTextLabel);
    statusTextLabel.setFont(juce::FontOptions(12.0f));
    statusTextLabel.setColour(juce::Label::textColourId, Theme::onSurfVar);
    statusTextLabel.setText("READY", juce::dontSendNotification);

    addAndMakeVisible(versionLabel);
    versionLabel.setText("v1.0.0", juce::dontSendNotification);
    versionLabel.setColour(juce::Label::textColourId, Theme::outline);
    versionLabel.setFont(juce::FontOptions(10.0f));
    versionLabel.setJustificationType(juce::Justification::centredRight);

    // ── Tab Bar ──
    const char* tabNames[] = { "LINK", "PRO DJ LINK", "TCNet", "SETTINGS" };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setButtonText(tabNames[i]);
        addAndMakeVisible(tabBtns[(size_t)i]);
        tabBtns[(size_t)i].setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
        tabBtns[(size_t)i].setColour(juce::TextButton::textColourOffId,
            i == 0 ? Theme::primaryCont : Theme::onSurfVar);
        tabBtns[(size_t)i].onClick = [this, i]
        {
            activeTab = (Tab)i;
            for (int j = 0; j < 4; j++)
                tabBtns[(size_t)j].setColour(juce::TextButton::textColourOffId,
                    j == i ? Theme::primaryCont : Theme::onSurfVar);

            // Show/hide content based on tab
            bool showDecks = (activeTab == TAB_LINK);
            bool showLayers = (activeTab == TAB_TCNET);
            bool showSettings = (activeTab == TAB_SETTINGS);

            for (int d = 0; d < visibleDecks; d++)
                if (deckPanels[(size_t)d])
                    deckPanels[(size_t)d]->setVisible(showDecks);

            addDeckBtn.setVisible(showDecks);
            virtualBtn.setVisible(showDecks);
            hwModeBtn.setVisible(showDecks);

            if (layerA) layerA->setVisible(showLayers);
            if (layerB) layerB->setVisible(showLayers);
            if (layerM) layerM->setVisible(showLayers);

            nodeNameLabel.setVisible(showSettings);
            nodeNameEditor.setVisible(showSettings);
            ifaceLabel.setVisible(showSettings);
            ifaceSelector.setVisible(showSettings);
            fpsLabel.setVisible(showSettings);
            fpsSelector.setVisible(showSettings);

            resized();
            repaint();
        };
    }

    // ── Status Badges ──
    auto setupBadge = [this](juce::Label& badge, const juce::String& text, juce::Colour col)
    {
        addAndMakeVisible(badge);
        badge.setText(text, juce::dontSendNotification);
        badge.setFont(juce::FontOptions(10.0f));
        badge.setColour(juce::Label::textColourId, col);
        badge.setJustificationType(juce::Justification::centredLeft);
    };

    setupBadge(tcnetBadge,  "TCNet: OFFLINE", Theme::error);
    setupBadge(arenaBadge,  "Arena: 0",       Theme::secondary);
    setupBadge(deckBadge,   "Decks: 0",       Theme::onSurfVar);
    setupBadge(uptimeBadge, "Uptime: 00:00:00", Theme::onSurfVar);

    // ── Mode Bar ──
    addAndMakeVisible(virtualBtn);
    virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::primaryDim.withAlpha(0.12f));
    virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont);
    virtualBtn.onClick = [this]
    {
        virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::primaryDim.withAlpha(0.12f));
        virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont);
        hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
        hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::onSurfVar);
    };

    addAndMakeVisible(hwModeBtn);
    hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
    hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::onSurfVar);
    hwModeBtn.onClick = [this]
    {
        hwModeBtn.setColour(juce::TextButton::buttonColourId, Theme::tertiaryAccent.withAlpha(0.12f));
        hwModeBtn.setColour(juce::TextButton::textColourOffId, Theme::tertiaryAccent);
        virtualBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
        virtualBtn.setColour(juce::TextButton::textColourOffId, Theme::onSurfVar);
    };

    addAndMakeVisible(addDeckBtn);
    addDeckBtn.setColour(juce::TextButton::buttonColourId, Theme::surfCont);
    addDeckBtn.setColour(juce::TextButton::textColourOffId, Theme::primaryCont);
    addDeckBtn.onClick = [this] { addDeck(); };

    // ── Output Layers (TCNet tab) ──
    layerA = std::make_unique<OutputLayerPanel>("A", Theme::primaryCont, engine, 0);
    layerB = std::make_unique<OutputLayerPanel>("B", Theme::secondary, engine, 1);
    layerM = std::make_unique<OutputLayerPanel>("M", Theme::tertiaryAccent, engine, 2);
    addAndMakeVisible(layerA.get()); layerA->setVisible(false);
    addAndMakeVisible(layerB.get()); layerB->setVisible(false);
    addAndMakeVisible(layerM.get()); layerM->setVisible(false);

    // ── Settings (SETTINGS tab) ──
    auto setupSettingsLabel = [this](juce::Label& lbl)
    {
        addAndMakeVisible(lbl);
        lbl.setFont(juce::FontOptions(11.0f));
        lbl.setColour(juce::Label::textColourId, Theme::onSurfVar);
        lbl.setVisible(false);
    };

    setupSettingsLabel(nodeNameLabel);
    setupSettingsLabel(ifaceLabel);
    setupSettingsLabel(fpsLabel);

    addAndMakeVisible(nodeNameEditor);
    nodeNameEditor.setColour(juce::TextEditor::backgroundColourId, Theme::surfCont);
    nodeNameEditor.setColour(juce::TextEditor::textColourId, Theme::onSurface);
    nodeNameEditor.setColour(juce::TextEditor::outlineColourId, Theme::outlineVar);
    nodeNameEditor.setText("BRIDGE+");
    nodeNameEditor.setVisible(false);

    addAndMakeVisible(ifaceSelector);
    ifaceSelector.setColour(juce::ComboBox::backgroundColourId, Theme::surfCont);
    ifaceSelector.setColour(juce::ComboBox::textColourId, Theme::onSurface);
    ifaceSelector.setColour(juce::ComboBox::outlineColourId, Theme::outlineVar);
    // Populate with available interfaces
    auto addresses = juce::IPAddress::getAllAddresses(false);
    int ifIdx = 1;
    for (const auto& addr : addresses)
    {
        auto ip = addr.toString();
        if (ip.contains(".") && !ip.startsWith("169.254."))
            ifaceSelector.addItem(ip, ifIdx++);
    }
    if (ifaceSelector.getNumItems() > 0) ifaceSelector.setSelectedId(1);
    ifaceSelector.setVisible(false);

    addAndMakeVisible(fpsSelector);
    fpsSelector.setColour(juce::ComboBox::backgroundColourId, Theme::surfCont);
    fpsSelector.setColour(juce::ComboBox::textColourId, Theme::onSurface);
    fpsSelector.setColour(juce::ComboBox::outlineColourId, Theme::outlineVar);
    fpsSelector.addItem("24 fps", 1);
    fpsSelector.addItem("25 fps", 2);
    fpsSelector.addItem("29.97 fps", 3);
    fpsSelector.addItem("30 fps", 4);
    fpsSelector.setSelectedId(2);
    fpsSelector.setVisible(false);

    // ── Bottom Bar ──
    addAndMakeVisible(packetLabel);
    packetLabel.setFont(juce::FontOptions(10.0f));
    packetLabel.setColour(juce::Label::textColourId, Theme::outline);
    packetLabel.setText("TCNet TX: 0", juce::dontSendNotification);
    packetLabel.setJustificationType(juce::Justification::centredRight);

    addAndMakeVisible(latencyLabel);
    latencyLabel.setFont(juce::FontOptions(10.0f));
    latencyLabel.setColour(juce::Label::textColourId, Theme::outline);
    latencyLabel.setText("", juce::dontSendNotification);
    latencyLabel.setJustificationType(juce::Justification::centredLeft);

    // ── Audio ──
    setAudioChannels(0, 2);

    setSize(1060, 740);
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
    if (visibleDecks >= 8) addDeckBtn.setEnabled(false);
}

// ── Audio ──
void MainComponent::prepareToPlay(int, double sampleRate)
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
        if (!engine.isVirtualDeckActive(d) || engine.isHWMode(d)) continue;
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

// ── Paint ──
void MainComponent::paint(juce::Graphics& g)
{
    int w = getWidth();
    int h = getHeight();
    g.fillAll(Theme::background);

    // ── Header (48px) ──
    g.setColour(Theme::surfContLo2);
    g.fillRect(0, 0, w, 48);

    // B+ logo
    g.setGradientFill(juce::ColourGradient(
        Theme::primaryCont, 14.0f, 10.0f,
        Theme::primaryDim, 38.0f, 38.0f, false));
    g.fillRoundedRectangle(10.0f, 10.0f, 28.0f, 28.0f, 6.0f);
    g.setColour(Theme::surfContLo2);
    g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText("B+", 10, 10, 28, 28, juce::Justification::centred);

    // Title
    g.setColour(Theme::onSurface);
    g.setFont(juce::FontOptions(15.0f, juce::Font::bold));
    g.drawText("BRIDGE+", 44, 8, 90, 17, juce::Justification::centredLeft);
    g.setColour(Theme::outline);
    g.setFont(juce::FontOptions(9.0f));
    g.drawText("PRO DJ LINK", 44, 25, 90, 13, juce::Justification::centredLeft);

    // Status dot
    juce::Colour dotCol = engine.isRunning() ? Theme::primaryCont : Theme::outline;
    g.setColour(dotCol);
    g.fillEllipse(148.0f, 20.0f, 8.0f, 8.0f);

    g.setColour(Theme::outlineVar);
    g.drawHorizontalLine(48, 0, (float)w);

    // ── Tab bar (32px) ──
    g.setColour(Theme::surfCont);
    g.fillRect(0, 48, w, 32);

    // Active tab underline
    if ((int)activeTab < 4)
    {
        auto& btn = tabBtns[(size_t)activeTab];
        g.setColour(Theme::primaryCont);
        g.fillRect(btn.getX(), 78, btn.getWidth(), 2);
    }
    g.setColour(Theme::outlineVar);
    g.drawHorizontalLine(80, 0, (float)w);

    // ── Status bar (24px) ──
    g.setColour(Theme::surfContHigh);
    g.fillRect(0, 80, w, 24);
    g.setColour(Theme::outlineVar);
    g.drawHorizontalLine(104, 0, (float)w);

    // ── Mode bar (32px) - only on LINK tab ──
    if (activeTab == TAB_LINK)
    {
        g.setColour(Theme::surfCont);
        g.fillRect(0, 104, w, 32);

        g.setColour(Theme::outline);
        g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        g.drawText("DECK MODE", 10, 104, 80, 32, juce::Justification::centredLeft);

        g.setColour(Theme::outlineVar);
        g.drawHorizontalLine(136, 0, (float)w);
    }

    // ── TCNet tab header ──
    if (activeTab == TAB_TCNET)
    {
        g.setColour(Theme::surfCont);
        g.fillRect(0, 104, w, 32);
        g.setColour(Theme::onSurface);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("OUTPUT LAYERS", 14, 104, 200, 32, juce::Justification::centredLeft);
        g.setColour(Theme::outlineVar);
        g.drawHorizontalLine(136, 0, (float)w);
    }

    // ── Settings tab header ──
    if (activeTab == TAB_SETTINGS)
    {
        g.setColour(Theme::surfCont);
        g.fillRect(0, 104, w, 32);
        g.setColour(Theme::onSurface);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONFIGURATION", 14, 104, 200, 32, juce::Justification::centredLeft);
        g.setColour(Theme::outlineVar);
        g.drawHorizontalLine(136, 0, (float)w);
    }

    // ── PRO DJ LINK tab ──
    if (activeTab == TAB_PDJL)
    {
        g.setColour(Theme::surfCont);
        g.fillRect(0, 104, w, 32);
        g.setColour(Theme::onSurface);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONNECTED DEVICES", 14, 104, 200, 32, juce::Justification::centredLeft);
        g.setColour(Theme::outlineVar);
        g.drawHorizontalLine(136, 0, (float)w);

        // DJM fader status
        auto djmArea = getLocalBounds().withTrimmedTop(140).withTrimmedBottom(28).reduced(14, 8);
        g.setColour(Theme::surfContHigh);
        g.fillRoundedRectangle(djmArea.toFloat(), 8.0f);
        g.setColour(Theme::outlineVar);
        g.drawRoundedRectangle(djmArea.toFloat().reduced(0.5f), 8.0f, 1.0f);

        g.setColour(Theme::onSurfVar);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("DJM Faders", djmArea.getX() + 12, djmArea.getY() + 8, 200, 20, juce::Justification::centredLeft);

        auto& djm = engine.getDJMStatus();
        for (int ch = 0; ch < 4; ch++)
        {
            int fx = djmArea.getX() + 20 + ch * 60;
            int fy = djmArea.getY() + 36;
            int fh = 100;

            // Fader track
            g.setColour(Theme::surfVariant);
            g.fillRoundedRectangle((float)fx, (float)fy, 8.0f, (float)fh, 3.0f);

            // Fader level
            float level = djm.faders[(size_t)ch];
            int filledH = (int)(level * fh);
            g.setColour(Theme::primaryCont.withAlpha(0.7f));
            g.fillRoundedRectangle((float)fx, (float)(fy + fh - filledH), 8.0f, (float)filledH, 3.0f);

            // Channel label
            g.setColour(djm.onAir[(size_t)ch] ? Theme::primaryCont : Theme::outline);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText("CH" + juce::String(ch + 1), fx - 8, fy + fh + 6, 24, 14, juce::Justification::centred);
        }
    }

    // ── Empty state ──
    if (activeTab == TAB_LINK && visibleDecks == 0)
    {
        g.setColour(Theme::outline);
        g.setFont(juce::FontOptions(14.0f));
        g.drawText("Click \"+ DECK\" to add a virtual deck",
                   getLocalBounds().withTrimmedTop(140).withTrimmedBottom(28),
                   juce::Justification::centred);
    }

    // ── Bottom bar (26px) ──
    g.setColour(Theme::surfContLo2);
    g.fillRect(0, h - 26, w, 26);
    g.setColour(Theme::outlineVar);
    g.drawHorizontalLine(h - 26, 0, (float)w);
}

void MainComponent::resized()
{
    int w = getWidth();

    // Header
    statusTextLabel.setBounds(160, 14, 80, 20);
    startBtn.setBounds(w - 140, 10, 128, 28);
    versionLabel.setBounds(w - 275, 10, 128, 28);

    // Tabs
    int tabX = 10;
    int tabWidths[] = { 46, 100, 56, 76 };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setBounds(tabX, 50, tabWidths[i], 28);
        tabX += tabWidths[i] + 4;
    }

    // Status bar
    int sx = 12;
    tcnetBadge.setBounds(sx, 82, 100, 20);  sx += 104;
    arenaBadge.setBounds(sx, 82, 70, 20);   sx += 74;
    deckBadge.setBounds(sx, 82, 70, 20);    sx += 74;
    uptimeBadge.setBounds(sx, 82, 130, 20);

    // Mode bar (LINK tab)
    virtualBtn.setBounds(92, 107, 70, 26);
    hwModeBtn.setBounds(166, 107, 80, 26);
    addDeckBtn.setBounds(w - 130, 107, 118, 26);

    // Bottom bar
    packetLabel.setBounds(w - 180, getHeight() - 24, 170, 22);
    latencyLabel.setBounds(10, getHeight() - 24, 200, 22);

    // Content area depends on tab
    if (activeTab == TAB_LINK)
        layoutDecks();
    else if (activeTab == TAB_TCNET)
        layoutOutputLayers();
    else if (activeTab == TAB_SETTINGS)
        layoutSettings();
}

void MainComponent::layoutDecks()
{
    if (visibleDecks == 0) return;

    auto area = getLocalBounds();
    area.removeFromTop(140);
    area.removeFromBottom(26);
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

void MainComponent::layoutOutputLayers()
{
    auto area = getLocalBounds();
    area.removeFromTop(140);
    area.removeFromBottom(26);
    area = area.reduced(14, 8);

    int layerW = (area.getWidth() - 16) / 3;
    int layerH = juce::jmin(200, area.getHeight());

    if (layerA) layerA->setBounds(area.getX(), area.getY(), layerW, layerH);
    if (layerB) layerB->setBounds(area.getX() + layerW + 8, area.getY(), layerW, layerH);
    if (layerM) layerM->setBounds(area.getX() + 2 * (layerW + 8), area.getY(), layerW, layerH);
}

void MainComponent::layoutSettings()
{
    auto area = getLocalBounds();
    area.removeFromTop(140);
    area.removeFromBottom(26);
    area = area.reduced(14, 8);

    int rowH = 30;
    int labelW = 130;

    auto row1 = area.removeFromTop(rowH);
    nodeNameLabel.setBounds(row1.removeFromLeft(labelW));
    nodeNameEditor.setBounds(row1.removeFromLeft(250));

    area.removeFromTop(6);
    auto row2 = area.removeFromTop(rowH);
    ifaceLabel.setBounds(row2.removeFromLeft(labelW));
    ifaceSelector.setBounds(row2.removeFromLeft(250));

    area.removeFromTop(6);
    auto row3 = area.removeFromTop(rowH);
    fpsLabel.setBounds(row3.removeFromLeft(labelW));
    fpsSelector.setBounds(row3.removeFromLeft(250));
}

void MainComponent::timerCallback()
{
    // Status updates
    if (engine.isRunning())
    {
        statusTextLabel.setText("RUNNING", juce::dontSendNotification);
        statusTextLabel.setColour(juce::Label::textColourId, Theme::primaryCont);
        tcnetBadge.setText("TCNet: ONLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, Theme::secondary);
        arenaBadge.setText("Arena: " + juce::String(engine.getNodeCount()), juce::dontSendNotification);
        uptimeBadge.setText("Uptime: " + formatUptime(engine.getUptimeSeconds()), juce::dontSendNotification);
        packetLabel.setText("TCNet TX: " + juce::String(engine.getPacketCount()), juce::dontSendNotification);
    }
    else
    {
        statusTextLabel.setText("READY", juce::dontSendNotification);
        statusTextLabel.setColour(juce::Label::textColourId, Theme::onSurfVar);
        tcnetBadge.setText("TCNet: OFFLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, Theme::error);
    }

    // Active deck count
    int activeCount = 0;
    for (int i = 0; i < 8; i++)
        if (engine.isVirtualDeckActive(i) || engine.isHWMode(i)) activeCount++;
    deckBadge.setText("Decks: " + juce::String(activeCount), juce::dontSendNotification);

    // Update deck panels
    if (activeTab == TAB_LINK)
    {
        for (int i = 0; i < visibleDecks; i++)
            if (deckPanels[(size_t)i])
                deckPanels[(size_t)i]->updateDisplay();
    }

    // Update output layers
    if (activeTab == TAB_TCNET)
    {
        if (layerA) layerA->updateDisplay();
        if (layerB) layerB->updateDisplay();
        if (layerM) layerM->updateDisplay();
    }

    // PRO DJ LINK tab needs repaint for DJM faders
    if (activeTab == TAB_PDJL)
        repaint();
}
