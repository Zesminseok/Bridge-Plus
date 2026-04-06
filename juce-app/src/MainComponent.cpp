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
    int f = (int)((totalMs % 1000) / (1000.0f / (float)fps));
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

    setupLabel(titleLabel,  13.0f, juce::Colour(0xffcbd5e1));  // Track title - light slate
    setupLabel(artistLabel, 10.0f, C::tx3);                     // Artist - dim
    setupLabel(bpmLabel,    11.0f, C::tx2);                     // BPM info
    setupLabel(timeLabel,   11.0f, C::tx3);                     // Time display

    titleLabel.setText("Empty", juce::dontSendNotification);
    artistLabel.setText("Load a track", juce::dontSendNotification);

    // ── CUE button (yellow) ──
    // Uses mouseDown/mouseUp via DeckPanel override, NOT onClick
    addAndMakeVisible(cueBtn);
    cueBtn.setColour(juce::TextButton::buttonColourId, C::bgHi);
    cueBtn.setColour(juce::TextButton::textColourOffId, C::ylw.withAlpha(0.5f));
    cueBtn.addMouseListener(this, false);  // Forward mouse events to DeckPanel

    // ── PLAY button (green) ──
    addAndMakeVisible(playBtn);
    playBtn.setColour(juce::TextButton::buttonColourId, C::bgHi);
    playBtn.setColour(juce::TextButton::textColourOffId, C::grn.withAlpha(0.5f));
    playBtn.onClick = [this]
    {
        DBG("=== PLAY clicked deck=" + juce::String(deckNum));
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).playPause();
    };

    // ── LOAD button ──
    addAndMakeVisible(loadBtn);
    loadBtn.setColour(juce::TextButton::buttonColourId, C::bg4);
    loadBtn.setColour(juce::TextButton::textColourOffId, C::tx3);
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
    ejectBtn.setColour(juce::TextButton::buttonColourId, C::bg4);
    ejectBtn.setColour(juce::TextButton::textColourOffId, C::red);
    ejectBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        engine.getVirtualDeck(deckNum).eject();
        engine.setVirtualDeckActive(deckNum, false);
        updateDisplay();
    };

    // ── HW/VIR toggle ──
    addAndMakeVisible(hwBtn);
    hwBtn.setColour(juce::TextButton::buttonColourId, C::bg4);
    hwBtn.setColour(juce::TextButton::textColourOffId, C::tx3);
    hwBtn.onClick = [this]
    {
        bool newHW = !engine.isHWMode(deckNum);
        engine.setHWMode(deckNum, newHW);
        hwBtn.setButtonText(newHW ? "HW" : "VIR");
        hwBtn.setColour(juce::TextButton::textColourOffId, newHW ? C::pur : C::tx3);
        updateDisplay();
    };

    // ── Volume slider ──
    addAndMakeVisible(volumeSlider);
    volumeSlider.setRange(0.0, 1.0, 0.01);
    volumeSlider.setValue(1.0);
    volumeSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    volumeSlider.setTextBoxStyle(juce::Slider::NoTextBox, true, 0, 0);
    volumeSlider.setColour(juce::Slider::trackColourId, C::bg4);
    volumeSlider.setColour(juce::Slider::thumbColourId, C::tx3);
    volumeSlider.onValueChange = [this]
    {
        engine.getVirtualDeck(deckNum).setVolume((float)volumeSlider.getValue());
    };
}

DeckPanel::~DeckPanel()
{
    cueBtn.removeMouseListener(this);
}

// ── CDJ-3000 CUE: mouseDown = instant, mouseUp = return ──

void DeckPanel::mouseDown(const juce::MouseEvent& e)
{
    if (e.eventComponent == &cueBtn)
    {
        DBG("=== CUE DOWN deck=" + juce::String(deckNum));
        if (!engine.isHWMode(deckNum))
            engine.getVirtualDeck(deckNum).cueDown();
        return;
    }
    Component::mouseDown(e);
}

void DeckPanel::mouseUp(const juce::MouseEvent& e)
{
    if (e.eventComponent == &cueBtn)
    {
        DBG("=== CUE UP deck=" + juce::String(deckNum));
        if (!engine.isHWMode(deckNum))
            engine.getVirtualDeck(deckNum).cueUp();
        return;
    }
    Component::mouseUp(e);
}

// ── Paint ──

void DeckPanel::paint(juce::Graphics& g)
{
    auto bounds = getLocalBounds().toFloat();
    bool isHW = engine.isHWMode(deckNum);

    // Card background
    g.setColour(C::bg2);
    g.fillRoundedRectangle(bounds, 12.0f);

    // Border + state glow
    juce::Colour borderCol = C::bdr;
    juce::Colour glowCol = juce::Colours::transparentBlack;

    if (isHW)
    {
        borderCol = C::pur.withAlpha(0.3f);
        if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
        {
            glowCol = C::grn2.withAlpha(0.06f);
            borderCol = C::grn2.withAlpha(0.4f);
        }
    }
    else
    {
        switch (displayState)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                borderCol = C::grn2.withAlpha(0.4f);
                glowCol = C::grn2.withAlpha(0.06f);
                break;
            case PlayState::CUED: case PlayState::CUEING:
                borderCol = C::ylw.withAlpha(0.35f);
                glowCol = C::ylw.withAlpha(0.04f);
                break;
            case PlayState::PAUSED:
                borderCol = C::org.withAlpha(0.3f);
                break;
            default: break;
        }
    }

    if (!glowCol.isTransparent())
    {
        g.setColour(glowCol);
        g.fillRoundedRectangle(bounds, 12.0f);
    }

    // ── Shimmer line (top 2px) ──
    if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
    {
        g.setGradientFill(juce::ColourGradient(
            juce::Colours::transparentBlack, bounds.getX(), 0,
            C::grn, bounds.getCentreX(), 0, false));
        g.fillRect(bounds.getX(), bounds.getY(), bounds.getWidth() / 2, 2.0f);
        g.setGradientFill(juce::ColourGradient(
            C::grn, bounds.getCentreX(), 0,
            juce::Colours::transparentBlack, bounds.getRight(), 0, false));
        g.fillRect(bounds.getCentreX(), bounds.getY(), bounds.getWidth() / 2, 2.0f);
    }
    else if (displayState == PlayState::CUED || displayState == PlayState::CUEING)
    {
        g.setGradientFill(juce::ColourGradient(
            juce::Colours::transparentBlack, bounds.getX(), 0,
            C::ylw.withAlpha(0.6f), bounds.getCentreX(), 0, false));
        g.fillRect(bounds.getX(), bounds.getY(), bounds.getWidth() / 2, 2.0f);
        g.setGradientFill(juce::ColourGradient(
            C::ylw.withAlpha(0.6f), bounds.getCentreX(), 0,
            juce::Colours::transparentBlack, bounds.getRight(), 0, false));
        g.fillRect(bounds.getCentreX(), bounds.getY(), bounds.getWidth() / 2, 2.0f);
    }

    g.setColour(borderCol);
    g.drawRoundedRectangle(bounds.reduced(0.5f), 12.0f, 1.0f);

    // ── Header row ──
    float hdrY = 10.0f;
    float px = 13.0f;

    // "PLAYER" small + number large
    g.setColour(C::tx3);
    g.setFont(juce::FontOptions(10.0f));
    g.drawText("PLAYER", (int)px, (int)hdrY, 46, 18, juce::Justification::centredLeft);
    px += 42.0f;
    g.setColour(C::tx);
    g.setFont(juce::FontOptions(18.0f, juce::Font::bold));
    g.drawText(juce::String(deckNum + 1), (int)px, (int)(hdrY - 2), 20, 22, juce::Justification::centredLeft);

    // State badge
    juce::String badge;
    juce::Colour badgeCol;
    auto& deck = engine.getVirtualDeck(deckNum);

    if (isHW)
    {
        badge = (displayState == PlayState::PLAYING) ? "HW PLAY" : "HW";
        badgeCol = (displayState == PlayState::PLAYING) ? C::grn : C::pur;
    }
    else if (!deck.isLoaded())
    {
        badge = "EMPTY";
        badgeCol = C::tx4;
    }
    else
    {
        badge = playStateToString(displayState);
        switch (displayState)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                badgeCol = C::grn; break;
            case PlayState::CUED: case PlayState::CUEING:
                badgeCol = C::ylw; break;
            case PlayState::PAUSED:
                badgeCol = C::org; break;
            case PlayState::STOPPED:
                badgeCol = C::red; break;
            default: badgeCol = C::tx4; break;
        }
    }

    float bw = (float)badge.length() * 7.0f + 12.0f;
    float badgeX = px + 26.0f;
    auto badgeRect = juce::Rectangle<float>(badgeX, hdrY + 2.0f, bw, 16.0f);
    g.setColour(badgeCol.withAlpha(0.15f));
    g.fillRoundedRectangle(badgeRect, 3.0f);
    g.setColour(badgeCol);
    g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
    g.drawText(badge, badgeRect, juce::Justification::centred);

    // Timecode (right-aligned)
    juce::String tc = formatTimecode(
        isHW ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->timecodeMs : 0.0f)
             : deck.getPositionMs());
    bool showBright = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING ||
                       displayState == PlayState::CUED || displayState == PlayState::CUEING);
    g.setColour(showBright ? C::tx : C::tx4);
    g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText(tc, 0, (int)hdrY, getWidth() - 13, 18, juce::Justification::centredRight);

    // ── Beat phasor (4 segments) ──
    float phasorY = (float)getHeight() - 20.0f;
    float totalW = (float)getWidth() - 26.0f;
    float segW = (totalW - 9.0f) / 4.0f;
    float phasorH = 5.0f;

    for (int i = 0; i < 4; i++)
    {
        auto seg = juce::Rectangle<float>(13.0f + (float)i * (segW + 3.0f), phasorY, segW, phasorH);
        int curBeat = beatPhase / 64;
        bool active = (i <= curBeat) && (displayState == PlayState::PLAYING ||
                                          displayState == PlayState::LOOPING);
        g.setColour(active ? C::grn.withAlpha(0.7f) : juce::Colour(0x0dffffff));
        g.fillRoundedRectangle(seg, 3.0f);
    }

    // ── HW label at bottom ──
    g.setColour(C::tx4);
    g.setFont(juce::FontOptions(9.0f));
    juce::String hwLabel = isHW ? juce::CharPointer_UTF8("\xe2\xac\xa1 HW") : juce::CharPointer_UTF8("\xe2\x97\x8e VIRTUAL");
    g.drawText(hwLabel, 13, getHeight() - 34, getWidth() - 26, 12, juce::Justification::centredLeft);
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(13);
    area.removeFromTop(32); // Header

    // Track title
    titleLabel.setBounds(area.removeFromTop(16));
    // Artist
    artistLabel.setBounds(area.removeFromTop(14));
    area.removeFromTop(2);

    // BPM + Time info row
    auto infoRow = area.removeFromTop(14);
    bpmLabel.setBounds(infoRow.removeFromLeft(90));
    timeLabel.setBounds(infoRow);

    area.removeFromTop(6);

    // CUE + PLAY buttons side by side
    auto btnRow = area.removeFromTop(36);
    int halfW = (btnRow.getWidth() - 6) / 2;
    cueBtn.setBounds(btnRow.removeFromLeft(halfW));
    btnRow.removeFromLeft(6);
    playBtn.setBounds(btnRow);

    area.removeFromTop(6);

    // Volume slider
    volumeSlider.setBounds(area.removeFromTop(16));

    area.removeFromTop(6);

    // Bottom controls: LOAD | HW/VIR | EJECT
    auto bottomRow = area.removeFromTop(24);
    int bw3 = (bottomRow.getWidth() - 8) / 3;
    loadBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    hwBtn.setBounds(bottomRow.removeFromLeft(bw3));
    bottomRow.removeFromLeft(4);
    ejectBtn.setBounds(bottomRow);

    // Beat phasor + HW label are painted, no layout needed
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

    // CUE button color update
    bool cueLit = (displayState == PlayState::CUED || displayState == PlayState::CUEING);
    cueBtn.setColour(juce::TextButton::buttonColourId,
        cueLit ? C::ylw2.withAlpha(0.25f) : C::bgHi);
    cueBtn.setColour(juce::TextButton::textColourOffId,
        cueLit ? C::ylw : C::ylw.withAlpha(0.5f));

    // PLAY button color update
    bool playLit = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);
    playBtn.setColour(juce::TextButton::buttonColourId,
        playLit ? C::grn2.withAlpha(0.25f) : C::bgHi);
    playBtn.setColour(juce::TextButton::textColourOffId,
        playLit ? C::grn : C::grn.withAlpha(0.5f));

    // HW toggle label
    hwBtn.setButtonText(isHW ? "HW" : "VIR");
    hwBtn.setColour(juce::TextButton::textColourOffId, isHW ? C::pur : C::tx3);

    repaint();
}

// ═══════════════════════════════════════════════
// ── MainComponent ──────────────────────────────
// ═══════════════════════════════════════════════

MainComponent::MainComponent()
{
    // ── Header ──
    addAndMakeVisible(startBtn);
    startBtn.setColour(juce::TextButton::buttonColourId, C::grn2.withAlpha(0.15f));
    startBtn.setColour(juce::TextButton::textColourOffId, C::grn);
    startBtn.onClick = [this]
    {
        if (engine.isRunning())
        {
            engine.stop();
            startBtn.setButtonText("START");
            startBtn.setColour(juce::TextButton::buttonColourId, C::grn2.withAlpha(0.15f));
            startBtn.setColour(juce::TextButton::textColourOffId, C::grn);
        }
        else
        {
            if (engine.start())
            {
                startBtn.setButtonText("STOP");
                startBtn.setColour(juce::TextButton::buttonColourId, C::red.withAlpha(0.15f));
                startBtn.setColour(juce::TextButton::textColourOffId, C::red);
            }
        }
    };

    addAndMakeVisible(statusLabel);
    statusLabel.setFont(juce::FontOptions(10.0f));
    statusLabel.setColour(juce::Label::textColourId, C::tx3);
    statusLabel.setText("READY", juce::dontSendNotification);

    addAndMakeVisible(versionLabel);
    versionLabel.setText("v1.0.0", juce::dontSendNotification);
    versionLabel.setColour(juce::Label::textColourId, C::tx4);
    versionLabel.setFont(juce::FontOptions(9.0f));
    versionLabel.setJustificationType(juce::Justification::centredRight);

    // ── Tab Bar ──
    const char* tabNames[] = { "LINK", "PRO DJ LINK", "TCNet", "SETTINGS" };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setButtonText(tabNames[i]);
        addAndMakeVisible(tabBtns[(size_t)i]);
        tabBtns[(size_t)i].setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
        tabBtns[(size_t)i].setColour(juce::TextButton::textColourOffId,
            i == 0 ? C::grn : C::tx.withAlpha(0.4f));
        tabBtns[(size_t)i].onClick = [this, i]
        {
            activeTab = (Tab)i;
            for (int j = 0; j < 4; j++)
                tabBtns[(size_t)j].setColour(juce::TextButton::textColourOffId,
                    j == i ? C::grn : C::tx.withAlpha(0.4f));

            bool showDecks = (activeTab == TAB_LINK);
            for (int d = 0; d < visibleDecks; d++)
                if (deckPanels[(size_t)d])
                    deckPanels[(size_t)d]->setVisible(showDecks);
            addDeckBtn.setVisible(showDecks);

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

    setupBadge(tcnetBadge,  "TCNet: OFFLINE", C::red);
    setupBadge(arenaBadge,  "Arena: 0",       C::blu);
    setupBadge(deckBadge,   "Decks: 0",       C::tx3);
    setupBadge(uptimeBadge, "Uptime: 00:00:00", C::tx3);

    // ── Add Deck button ──
    addAndMakeVisible(addDeckBtn);
    addDeckBtn.setColour(juce::TextButton::buttonColourId, C::bg3);
    addDeckBtn.setColour(juce::TextButton::textColourOffId, C::grn);
    addDeckBtn.onClick = [this] { addDeck(); };

    // ── Bottom Bar ──
    addAndMakeVisible(packetLabel);
    packetLabel.setFont(juce::FontOptions(10.0f));
    packetLabel.setColour(juce::Label::textColourId, C::tx4);
    packetLabel.setText("TCNet TX: 0", juce::dontSendNotification);
    packetLabel.setJustificationType(juce::Justification::centredRight);

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
    g.fillAll(C::bg);

    // ── Header (52px) ──
    g.setColour(C::bg);
    g.fillRect(0, 0, w, 52);

    // B+ logo badge
    g.setGradientFill(juce::ColourGradient(
        C::grn2, 14.0f, 12.0f,
        C::grn, 42.0f, 40.0f, false));
    g.fillRoundedRectangle(10.0f, 12.0f, 28.0f, 28.0f, 6.0f);
    g.setColour(juce::Colour(0xff003825));
    g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
    g.drawText("B+", 10, 12, 28, 28, juce::Justification::centred);

    // Title
    g.setColour(C::tx);
    g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
    g.drawText("BRIDGE+", 44, 12, 90, 15, juce::Justification::centredLeft);
    g.setColour(C::tx3);
    g.setFont(juce::FontOptions(9.0f));
    g.drawText("PRO DJ LINK", 44, 27, 90, 12, juce::Justification::centredLeft);

    // Status dot
    juce::Colour dotCol = engine.isRunning() ? C::grn : C::tx4;
    g.setColour(dotCol);
    g.fillEllipse(148.0f, 22.0f, 8.0f, 8.0f);

    // ── Tab bar (36px) ──
    g.setColour(C::bgLo);
    g.fillRect(0, 52, w, 36);

    // Active tab underline
    if ((int)activeTab < 4)
    {
        auto& btn = tabBtns[(size_t)activeTab];
        g.setColour(C::grn);
        g.fillRect(btn.getX() + 14, 86, btn.getWidth() - 28, 2);
    }

    g.setColour(C::bdr);
    g.drawHorizontalLine(52, 0, (float)w);
    g.drawHorizontalLine(88, 0, (float)w);

    // ── Status bar (24px) ──
    g.setColour(C::bg3);
    g.fillRect(0, 88, w, 24);
    g.setColour(C::bdr);
    g.drawHorizontalLine(112, 0, (float)w);

    // ── Mode bar (32px) - LINK tab ──
    if (activeTab == TAB_LINK)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);

        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        g.drawText("DECK MODE", 10, 112, 80, 32, juce::Justification::centredLeft);

        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);
    }

    // ── PRO DJ LINK tab ──
    if (activeTab == TAB_PDJL)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONNECTED DEVICES", 14, 112, 200, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // DJM fader display
        auto djmArea = getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26).reduced(14, 8);
        g.setColour(C::bg2);
        g.fillRoundedRectangle(djmArea.toFloat(), 12.0f);
        g.setColour(C::bdr2);
        g.drawRoundedRectangle(djmArea.toFloat().reduced(0.5f), 12.0f, 1.0f);

        g.setColour(C::tx2);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("DJM Faders", djmArea.getX() + 12, djmArea.getY() + 8, 200, 20, juce::Justification::centredLeft);

        auto& djm = engine.getDJMStatus();
        for (int ch = 0; ch < 4; ch++)
        {
            int fx = djmArea.getX() + 20 + ch * 60;
            int fy = djmArea.getY() + 36;
            int fh = 100;

            g.setColour(C::bg4);
            g.fillRoundedRectangle((float)fx, (float)fy, 8.0f, (float)fh, 3.0f);

            float level = djm.faders[(size_t)ch];
            int filledH = (int)(level * (float)fh);
            g.setColour(C::grn.withAlpha(0.7f));
            g.fillRoundedRectangle((float)fx, (float)(fy + fh - filledH), 8.0f, (float)filledH, 3.0f);

            g.setColour(djm.onAir[(size_t)ch] ? C::grn : C::tx4);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText("CH" + juce::String(ch + 1), fx - 8, fy + fh + 6, 24, 14, juce::Justification::centred);
        }
    }

    // ── TCNet tab ──
    if (activeTab == TAB_TCNET)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("OUTPUT LAYERS", 14, 112, 200, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // Draw 3 output layer cards
        auto layerArea = getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26).reduced(14, 8);
        int layerW = (layerArea.getWidth() - 16) / 3;
        int layerH = juce::jmin(180, layerArea.getHeight());

        const char* layerNames[] = { "A", "B", "M" };
        juce::Colour layerCols[] = { C::grn, C::blu, C::pur };

        for (int li = 0; li < 3; li++)
        {
            auto lr = juce::Rectangle<int>(
                layerArea.getX() + li * (layerW + 8),
                layerArea.getY(), layerW, layerH);

            g.setColour(C::bg2);
            g.fillRoundedRectangle(lr.toFloat(), 12.0f);
            g.setColour(layerCols[li].withAlpha(0.3f));
            g.drawRoundedRectangle(lr.toFloat().reduced(0.5f), 12.0f, 1.0f);

            // Color indicator
            g.setColour(layerCols[li]);
            g.fillRoundedRectangle((float)(lr.getX() + 12), (float)(lr.getY() + 12), 4.0f, 20.0f, 2.0f);

            // Layer name
            g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
            g.drawText(juce::String("Layer ") + layerNames[li],
                       lr.getX() + 22, lr.getY() + 10, 100, 24, juce::Justification::centredLeft);

            // Timecode
            auto* ls = engine.getLayerState(li);
            juce::String tc = ls ? formatTimecode(ls->timecodeMs) : "00:00:00:00";
            g.setColour(C::tx);
            g.setFont(juce::FontOptions(20.0f, juce::Font::bold));
            g.drawText(tc, lr.getX() + 12, lr.getY() + 44, lr.getWidth() - 24, 28, juce::Justification::centred);

            // Source label
            g.setColour(C::tx3);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText("Source: Layer " + juce::String(li + 1),
                       lr.getX() + 12, lr.getY() + 80, lr.getWidth() - 24, 16, juce::Justification::centred);
        }
    }

    // ── Settings tab ──
    if (activeTab == TAB_SETTINGS)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONFIGURATION", 14, 112, 200, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // Settings info
        g.setColour(C::tx3);
        g.setFont(juce::FontOptions(12.0f));
        g.drawText("Node Name: BRIDGE+", 30, 160, 300, 20, juce::Justification::centredLeft);
        g.drawText("FPS: 25", 30, 185, 300, 20, juce::Justification::centredLeft);

        auto addresses = juce::IPAddress::getAllAddresses(false);
        int yy = 210;
        g.drawText("Network Interfaces:", 30, yy, 300, 20, juce::Justification::centredLeft);
        for (const auto& addr : addresses)
        {
            auto ip = addr.toString();
            if (ip.contains(".") && !ip.startsWith("169.254."))
            {
                yy += 20;
                g.drawText("  " + ip, 30, yy, 300, 20, juce::Justification::centredLeft);
            }
        }
    }

    // ── Empty state ──
    if (activeTab == TAB_LINK && visibleDecks == 0)
    {
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(14.0f));
        g.drawText("Click \"+ DECK\" to add a virtual deck",
                   getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26),
                   juce::Justification::centred);
    }

    // ── Bottom bar (26px) ──
    g.setColour(C::bgLo);
    g.fillRect(0, h - 26, w, 26);
    g.setColour(C::bdr);
    g.drawHorizontalLine(h - 26, 0, (float)w);
}

void MainComponent::resized()
{
    int w = getWidth();

    // Header
    statusLabel.setBounds(160, 18, 80, 16);
    startBtn.setBounds(w - 108, 14, 96, 24);
    versionLabel.setBounds(w - 210, 14, 96, 24);

    // Tabs
    int tabX = 10;
    int tabWidths[] = { 46, 100, 56, 76 };
    for (int i = 0; i < 4; i++)
    {
        tabBtns[(size_t)i].setBounds(tabX, 54, tabWidths[i], 32);
        tabX += tabWidths[i] + 4;
    }

    // Status bar
    int sx = 12;
    tcnetBadge.setBounds(sx, 90, 100, 20);  sx += 104;
    arenaBadge.setBounds(sx, 90, 70, 20);   sx += 74;
    deckBadge.setBounds(sx, 90, 70, 20);    sx += 74;
    uptimeBadge.setBounds(sx, 90, 130, 20);

    // Mode bar
    addDeckBtn.setBounds(w - 130, 115, 118, 26);

    // Bottom bar
    packetLabel.setBounds(w - 180, getHeight() - 24, 170, 22);

    // Content
    if (activeTab == TAB_LINK)
        layoutDecks();
}

void MainComponent::layoutDecks()
{
    if (visibleDecks == 0) return;

    auto area = getLocalBounds();
    area.removeFromTop(148);
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

void MainComponent::timerCallback()
{
    // Status updates
    if (engine.isRunning())
    {
        statusLabel.setText("RUNNING", juce::dontSendNotification);
        statusLabel.setColour(juce::Label::textColourId, C::grn);
        tcnetBadge.setText("TCNet: ONLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, C::blu);
        arenaBadge.setText("Arena: " + juce::String(engine.getNodeCount()), juce::dontSendNotification);
        uptimeBadge.setText("Uptime: " + formatUptime(engine.getUptimeSeconds()), juce::dontSendNotification);
        packetLabel.setText("TCNet TX: " + juce::String(engine.getPacketCount()), juce::dontSendNotification);
    }
    else
    {
        statusLabel.setText("READY", juce::dontSendNotification);
        statusLabel.setColour(juce::Label::textColourId, C::tx3);
        tcnetBadge.setText("TCNet: OFFLINE", juce::dontSendNotification);
        tcnetBadge.setColour(juce::Label::textColourId, C::red);
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

    // TCNet/PDJL tabs need repaint for live data
    if (activeTab == TAB_TCNET || activeTab == TAB_PDJL)
        repaint();
}
