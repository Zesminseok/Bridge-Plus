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

// Persistent last-used directory for file chooser
static juce::File sLastDir = juce::File::getSpecialLocation(juce::File::userMusicDirectory);

// ─────────────────────────────────────────────
// Waveform drawing helpers
// ─────────────────────────────────────────────

/** Draw overview (mini) waveform */
static void drawOverviewWaveform(juce::Graphics& g,
    const juce::Rectangle<int>& bounds,
    const std::vector<DetailedWaveformPoint>& wf,
    float posMs, float durMs)
{
    auto bf = bounds.toFloat();
    g.setColour(C::bgLo);
    g.fillRoundedRectangle(bf, 3.0f);

    if (wf.empty()) return;

    int W = bounds.getWidth();
    float H = bf.getHeight();
    float midY = bf.getCentreY();

    int pts = (int)wf.size();
    float step = (float)pts / (float)W;

    for (int x = 0; x < W; x++)
    {
        int idx = juce::jlimit(0, pts - 1, (int)((float)x * step));
        const auto& p = wf[(size_t)idx];

        float bassH  = p.bass  * H * 0.42f;
        float midH   = p.mid   * H * 0.38f;
        float peakH  = p.peak  * H * 0.48f;

        // Peak envelope (very dim)
        g.setColour(juce::Colour(0x22e2e2e8));
        g.drawVerticalLine(bounds.getX() + x, midY - peakH, midY + peakH);
        // Mid (green)
        g.setColour(juce::Colour(0x8034d399));
        g.drawVerticalLine(bounds.getX() + x, midY - midH,  midY + midH);
        // Bass (blue)
        g.setColour(juce::Colour(0x9960a5fa));
        g.drawVerticalLine(bounds.getX() + x, midY - bassH, midY + bassH);
    }

    // Progress line
    if (durMs > 0)
    {
        float prog = juce::jlimit(0.0f, 1.0f, posMs / durMs);
        int px = bounds.getX() + (int)(prog * (float)W);
        g.setColour(juce::Colour(0xcc60a5fa));
        g.drawVerticalLine(px, bf.getY(), bf.getBottom());
    }

    g.setColour(C::bdr);
    g.drawRoundedRectangle(bf.reduced(0.5f), 3.0f, 1.0f);
}

/** Draw zoom waveform (centered on playhead) */
static void drawZoomWaveform(juce::Graphics& g,
    const juce::Rectangle<int>& bounds,
    const std::vector<DetailedWaveformPoint>& wf,
    float posMs, float durMs,
    float bpm)
{
    auto bf = bounds.toFloat();
    g.setColour(C::bgLo);
    g.fillRoundedRectangle(bf, 6.0f);

    if (wf.empty())
    {
        g.setColour(C::bdr);
        g.drawRoundedRectangle(bf.reduced(0.5f), 6.0f, 1.0f);
        return;
    }

    int W = bounds.getWidth();
    float H = bf.getHeight();
    float midY = bf.getCentreY();

    int pts = (int)wf.size();
    float dur = juce::jmax(1.0f, durMs);

    // Show ~4 seconds window around playhead
    float windowMs = 4000.0f;
    float startMs = posMs - windowMs * 0.5f;
    float endMs   = startMs + windowMs;

    // Convert to waveform indices
    float msPerPt = dur / (float)pts;
    int startPt = (int)(startMs / msPerPt);
    int endPt   = (int)(endMs   / msPerPt);

    // Beat grid lines
    if (bpm > 0)
    {
        float msPerBeat = 60000.0f / bpm;
        float firstBeat = std::ceil(startMs / msPerBeat) * msPerBeat;
        g.setColour(juce::Colour(0x18ffffff));
        for (float beatMs = firstBeat; beatMs < endMs; beatMs += msPerBeat)
        {
            float t = (beatMs - startMs) / windowMs;
            int x = bounds.getX() + (int)(t * (float)W);
            g.drawVerticalLine(x, bf.getY() + 2, bf.getBottom() - 2);
        }
    }

    // Waveform bars
    float ptsPerPx = (float)(endPt - startPt) / (float)W;
    for (int x = 0; x < W; x++)
    {
        int idx = juce::jlimit(0, pts - 1, startPt + (int)((float)x * ptsPerPx));
        const auto& p = wf[(size_t)idx];

        float bassH   = p.bass   * H * 0.40f;
        float midH    = p.mid    * H * 0.35f;
        float trebleH = p.treble * H * 0.25f;
        float peakH   = p.peak   * H * 0.48f;

        // Past (left of playhead): dimmer
        float distNorm = std::abs((float)x / (float)W - 0.5f);
        bool isPast = (x < W / 2);
        float alpha = isPast ? 0.45f : 0.85f;
        alpha *= (1.0f - distNorm * 0.3f);

        g.setColour(juce::Colour(0xff60a5fa).withAlpha(alpha * 0.7f));
        g.drawVerticalLine(bounds.getX() + x, midY - bassH, midY + bassH);
        g.setColour(juce::Colour(0xff34d399).withAlpha(alpha * 0.75f));
        g.drawVerticalLine(bounds.getX() + x, midY - midH,  midY + midH);
        g.setColour(juce::Colour(0xffe2e8f0).withAlpha(alpha * 0.45f));
        g.drawVerticalLine(bounds.getX() + x, midY - trebleH, midY + trebleH);
        // Peak envelope
        g.setColour(juce::Colour(0x18e2e2e8));
        g.drawVerticalLine(bounds.getX() + x, midY - peakH, midY + peakH);
    }

    // Playhead center line
    int cx = bounds.getX() + W / 2;
    g.setColour(juce::Colour(0xeeffffff));
    g.drawVerticalLine(cx, bf.getY() + 1, bf.getBottom() - 1);

    // BPM label
    if (bpm > 0)
    {
        juce::String bpmStr = juce::String(bpm, 1) + " BPM";
        g.setColour(juce::Colour(0xbbbbcac0));
        g.setFont(juce::FontOptions(11.0f));
        g.drawText(bpmStr, bounds.getX() + 4, bounds.getBottom() - 18,
                   80, 16, juce::Justification::centredLeft);
    }

    g.setColour(C::bdr);
    g.drawRoundedRectangle(bf.reduced(0.5f), 6.0f, 1.0f);
}

// ═══════════════════════════════════════════════
// ── DeckPanel ──────────────────────────────────
// ═══════════════════════════════════════════════

DeckPanel::DeckPanel(int num, BridgeEngine& eng)
    : deckNum(num), engine(eng)
{
    // Title label
    addAndMakeVisible(titleLabel);
    titleLabel.setFont(juce::FontOptions(12.0f, juce::Font::bold));
    titleLabel.setColour(juce::Label::textColourId, juce::Colour(0xffcbd5e1));
    titleLabel.setText("Empty", juce::dontSendNotification);

    // Artist label
    addAndMakeVisible(artistLabel);
    artistLabel.setFont(juce::FontOptions(10.0f));
    artistLabel.setColour(juce::Label::textColourId, C::tx3);
    artistLabel.setText("Load a track", juce::dontSendNotification);

    // ── CUE button (yellow, circular) ──
    addAndMakeVisible(cueBtn);
    cueBtn.setLookAndFeel(&circleLF);
    cueBtn.setColour(juce::TextButton::buttonColourId, C::bgHi);
    cueBtn.setColour(juce::TextButton::textColourOffId, C::ylw.withAlpha(0.5f));
    cueBtn.addMouseListener(this, false);

    // ── PLAY button (green, circular) ──
    addAndMakeVisible(playBtn);
    playBtn.setLookAndFeel(&circleLF);
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
            "Select Audio File", sLastDir,
            "*.wav;*.mp3;*.aiff;*.flac;*.m4a;*.aac;*.ogg");

        chooser->launchAsync(
            juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
            [this, fc = chooser](const juce::FileChooser& c)
            {
                auto file = c.getResult();
                if (!file.existsAsFile()) return;
                sLastDir = file.getParentDirectory();   // remember directory
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
}

DeckPanel::~DeckPanel()
{
    cueBtn.removeMouseListener(this);
    cueBtn.setLookAndFeel(nullptr);
    playBtn.setLookAndFeel(nullptr);
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
    auto& deck = engine.getVirtualDeck(deckNum);

    // ── Card background ──
    g.setColour(C::bg2);
    g.fillRoundedRectangle(bounds, 12.0f);

    // ── Status-based glow + border ──
    juce::Colour borderCol = C::bdr;
    juce::Colour glowCol = juce::Colours::transparentBlack;

    if (isHW)
    {
        borderCol = C::pur.withAlpha(0.3f);
        if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
        {
            glowCol   = C::grn2.withAlpha(0.06f);
            borderCol = C::grn2.withAlpha(0.4f);
        }
    }
    else
    {
        switch (displayState)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                borderCol = C::grn2.withAlpha(0.4f);
                glowCol   = C::grn2.withAlpha(0.06f);
                break;
            case PlayState::CUED: case PlayState::CUEING:
                borderCol = C::ylw.withAlpha(0.35f);
                glowCol   = C::ylw.withAlpha(0.04f);
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

    // ── Shimmer line at top (2px) ──
    juce::Colour shimCol = juce::Colours::transparentBlack;
    if (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING)
        shimCol = C::grn;
    else if (displayState == PlayState::CUED || displayState == PlayState::CUEING)
        shimCol = C::ylw.withAlpha(0.6f);

    if (!shimCol.isTransparent())
    {
        auto hw = bounds.getWidth() / 2.0f;
        g.setGradientFill(juce::ColourGradient(
            juce::Colours::transparentBlack, bounds.getX(), 0,
            shimCol, bounds.getX() + hw, 0, false));
        g.fillRect(bounds.getX(), bounds.getY(), hw, 2.0f);
        g.setGradientFill(juce::ColourGradient(
            shimCol, bounds.getX() + hw, 0,
            juce::Colours::transparentBlack, bounds.getRight(), 0, false));
        g.fillRect(bounds.getX() + hw, bounds.getY(), hw, 2.0f);
    }

    g.setColour(borderCol);
    g.drawRoundedRectangle(bounds.reduced(0.5f), 12.0f, 1.0f);

    // ── Header: PLAYER N | badge | timecode ──
    float hdrY = 12.0f;
    float px   = 13.0f;

    // "PLAYER" small
    g.setColour(C::tx3);
    g.setFont(juce::FontOptions(10.0f));
    g.drawText("PLAYER", (int)px, (int)hdrY, 44, 18, juce::Justification::centredLeft);

    // Number large
    g.setColour(C::tx);
    g.setFont(juce::FontOptions(18.0f, juce::Font::bold));
    g.drawText(juce::String(deckNum + 1), (int)(px + 42), (int)(hdrY - 1), 20, 20,
               juce::Justification::centredLeft);

    // State badge
    juce::String badge;
    juce::Colour badgeCol;
    if (isHW)
    {
        badge    = (displayState == PlayState::PLAYING) ? "HW PLAY" : "HW";
        badgeCol = (displayState == PlayState::PLAYING) ? C::grn : C::pur;
    }
    else if (!deck.isLoaded())
    {
        badge = "EMPTY"; badgeCol = C::tx4;
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

    float bw = (float)badge.length() * 6.5f + 12.0f;
    auto badgeRect = juce::Rectangle<float>(px + 70.0f, hdrY + 3.0f, bw, 14.0f);
    g.setColour(badgeCol.withAlpha(0.15f));
    g.fillRoundedRectangle(badgeRect, 3.0f);
    g.setColour(badgeCol);
    g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
    g.drawText(badge, badgeRect, juce::Justification::centred);

    // Timecode (right aligned)
    float tcMs = isHW
        ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->timecodeMs : 0.0f)
        : deck.getPositionMs();
    bool showBright = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING ||
                       displayState == PlayState::CUED    || displayState == PlayState::CUEING);
    g.setColour(showBright ? C::tx : C::tx4);
    g.setFont(juce::FontOptions(14.0f, juce::Font::bold));
    g.drawText(formatTimecode(tcMs), 0, (int)hdrY, getWidth() - 13, 18,
               juce::Justification::centredRight);

    // ── Album art placeholder ──
    if (!artBounds.isEmpty())
    {
        auto af = artBounds.toFloat();
        g.setColour(C::bgLo);
        g.fillRoundedRectangle(af, 8.0f);
        g.setColour(C::bdr2);
        g.drawRoundedRectangle(af.reduced(0.5f), 8.0f, 1.0f);
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(22.0f));
        // ♪
        g.drawText(juce::CharPointer_UTF8("\xe2\x99\xaa"), artBounds, juce::Justification::centred);
    }

    // ── Overview waveform ──
    float posMs = deck.getPositionMs();
    float durMs = deck.getDurationMs();
    drawOverviewWaveform(g, ovWfBounds, deck.getWaveformData(), posMs, durMs);

    // ── Zoom waveform ──
    drawZoomWaveform(g, zoomWfBounds, deck.getWaveformData(), posMs, durMs, deck.getBpm());

    // ── Beat phasor (4 segments, only current beat lit) ──
    if (!phasorBounds.isEmpty())
    {
        float totalW = (float)phasorBounds.getWidth();
        float segW   = (totalW - 9.0f) / 4.0f;
        float segH   = (float)phasorBounds.getHeight();
        int curBeat  = beatPhase / 64;
        bool playing = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);

        for (int i = 0; i < 4; i++)
        {
            auto seg = juce::Rectangle<float>(
                (float)phasorBounds.getX() + (float)i * (segW + 3.0f),
                (float)phasorBounds.getY(), segW, segH);

            if (playing && i == curBeat)
                g.setColour(C::grn.withAlpha(0.9f));       // current beat: bright
            else if (playing && i < curBeat)
                g.setColour(C::grn.withAlpha(0.12f));       // past beats: very dim
            else
                g.setColour(juce::Colour(0x0dffffff));       // inactive
            g.fillRoundedRectangle(seg, 3.0f);
        }
    }

    // ── Bottom: HW/Virtual label ──
    g.setColour(C::tx4);
    g.setFont(juce::FontOptions(9.0f));
    juce::String hwLabel = isHW
        ? juce::CharPointer_UTF8("\xe2\xac\xa1 HW")
        : juce::CharPointer_UTF8("\xe2\x97\x8e VIRTUAL");
    g.drawText(hwLabel, 13, getHeight() - 18, getWidth() - 26, 14,
               juce::Justification::centredLeft);
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(13);
    area.removeFromTop(32);  // header (painted)
    area.removeFromBottom(20); // bottom label + phasor area

    // Track info labels
    titleLabel.setBounds(area.removeFromTop(16));
    artistLabel.setBounds(area.removeFromTop(13));
    area.removeFromTop(4);

    // Reserve bottom: LOAD/EJECT row + gap
    auto bottomRow = area.removeFromBottom(26);
    area.removeFromBottom(5);

    // Reserve phasor
    auto phasorRow = area.removeFromBottom(6);
    area.removeFromBottom(4);

    phasorBounds = phasorRow;

    // Content body: left column (70px) | gap (6px) | right column
    auto leftCol = area.removeFromLeft(70);
    area.removeFromLeft(6);
    auto rightCol = area;  // waveforms

    // Left column: art box (70x70) + gap + [CUE][PLAY]
    artBounds = leftCol.removeFromTop(70);
    leftCol.removeFromTop(4);
    auto btnRow = leftCol.removeFromTop(36);
    int halfBW = (btnRow.getWidth() - 4) / 2;
    cueBtn.setBounds(btnRow.removeFromLeft(halfBW));
    btnRow.removeFromLeft(4);
    playBtn.setBounds(btnRow);

    // Right column: overview wf | gap | zoom wf
    ovWfBounds = rightCol.removeFromTop(18);
    rightCol.removeFromTop(3);
    zoomWfBounds = rightCol;  // remaining space

    // Bottom row: LOAD | EJECT
    int bw2 = (bottomRow.getWidth() - 4) / 2;
    loadBtn.setBounds(bottomRow.removeFromLeft(bw2));
    bottomRow.removeFromLeft(4);
    ejectBtn.setBounds(bottomRow);
}

void DeckPanel::updateDisplay()
{
    bool isHW = engine.isHWMode(deckNum);
    auto& deck = engine.getVirtualDeck(deckNum);

    if (isHW)
    {
        auto* ls = engine.getLayerState(deckNum);
        if (ls)
        {
            displayState = ls->state;
            beatPhase    = ls->beatPhase;
            titleLabel.setText(ls->trackName.isEmpty()
                ? "CDJ-" + juce::String(deckNum + 1) : ls->trackName,
                juce::dontSendNotification);
            artistLabel.setText(ls->artistName.isEmpty()
                ? ls->deviceName : ls->artistName,
                juce::dontSendNotification);
        }
        else
        {
            displayState = PlayState::IDLE;
            titleLabel.setText("CDJ-" + juce::String(deckNum + 1) + " (waiting...)",
                juce::dontSendNotification);
            artistLabel.setText("Hardware Mode", juce::dontSendNotification);
        }
        loadBtn.setEnabled(false);
        ejectBtn.setEnabled(false);
        playBtn.setEnabled(false);
        cueBtn.setEnabled(false);
    }
    else
    {
        loadBtn.setEnabled(true);
        ejectBtn.setEnabled(true);
        playBtn.setEnabled(true);
        cueBtn.setEnabled(true);

        if (deck.isLoaded())
        {
            displayState = deck.getState();
            beatPhase    = deck.getBeatPhase();
            titleLabel.setText(deck.getTitle(), juce::dontSendNotification);
            artistLabel.setText(deck.getArtist().isEmpty()
                ? "Virtual Deck" : deck.getArtist(),
                juce::dontSendNotification);
        }
        else
        {
            displayState = PlayState::IDLE;
            beatPhase    = 0;
            titleLabel.setText("Empty", juce::dontSendNotification);
            artistLabel.setText("Load a track", juce::dontSendNotification);
        }
    }

    // CUE button colors
    bool cueLit = (displayState == PlayState::CUED || displayState == PlayState::CUEING);
    cueBtn.setColour(juce::TextButton::buttonColourId,
        cueLit ? C::ylw2.withAlpha(0.2f) : C::bgHi);
    cueBtn.setColour(juce::TextButton::textColourOffId,
        cueLit ? C::ylw : C::ylw.withAlpha(0.5f));

    // PLAY button colors
    bool playLit = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);
    bool playCue = (displayState == PlayState::CUED || displayState == PlayState::CUEING);
    playBtn.setColour(juce::TextButton::buttonColourId,
        playLit ? C::grn2.withAlpha(0.2f) : C::bgHi);
    playBtn.setColour(juce::TextButton::textColourOffId,
        playLit ? C::grn : (playCue ? C::grn.withAlpha(0.35f) : C::grn.withAlpha(0.5f)));

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
            // Pass selected interface from settings
            juce::String iface;
            if (tcnetIfaceSelector.getNumItems() > 0)
                iface = tcnetIfaceSelector.getText();

            if (engine.start(iface))
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

            // Settings visibility
            bool showSettings = (activeTab == TAB_SETTINGS);
            nodeNameLabel.setVisible(showSettings);
            nodeNameEditor.setVisible(showSettings);
            tcnetIfaceLabel.setVisible(showSettings);
            tcnetIfaceSelector.setVisible(showSettings);
            pdjlIfaceLabel.setVisible(showSettings);
            pdjlIfaceSelector.setVisible(showSettings);
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
    setupBadge(tcnetBadge,  "TCNet: OFFLINE",  C::red);
    setupBadge(arenaBadge,  "Arena: 0",        C::blu);
    setupBadge(deckBadge,   "Decks: 0",        C::tx3);
    setupBadge(uptimeBadge, "Uptime: 00:00:00", C::tx3);

    // ── Add Deck button ──
    addAndMakeVisible(addDeckBtn);
    addDeckBtn.setColour(juce::TextButton::buttonColourId, C::bg3);
    addDeckBtn.setColour(juce::TextButton::textColourOffId, C::grn);
    addDeckBtn.onClick = [this] { addDeck(); };

    // ── Settings components ──
    auto setupSettingsLabel = [this](juce::Label& lbl, const juce::String& text)
    {
        addAndMakeVisible(lbl);
        lbl.setText(text, juce::dontSendNotification);
        lbl.setFont(juce::FontOptions(11.0f));
        lbl.setColour(juce::Label::textColourId, C::tx3);
        lbl.setVisible(false);
    };
    setupSettingsLabel(nodeNameLabel,   "Node Name");
    setupSettingsLabel(tcnetIfaceLabel, "TCNet Interface");
    setupSettingsLabel(pdjlIfaceLabel,  "Pro DJ Link Interface");
    setupSettingsLabel(fpsLabel,        "Frame Rate");

    addAndMakeVisible(nodeNameEditor);
    nodeNameEditor.setColour(juce::TextEditor::backgroundColourId, C::bg3);
    nodeNameEditor.setColour(juce::TextEditor::textColourId, C::tx);
    nodeNameEditor.setColour(juce::TextEditor::outlineColourId, C::bdr2);
    nodeNameEditor.setText("BRIDGE+");
    nodeNameEditor.setVisible(false);

    // Populate network interfaces
    auto populateIfaces = [](juce::ComboBox& cb)
    {
        cb.addItem("Auto", 1);
        auto addresses = juce::IPAddress::getAllAddresses(false);
        int idx = 2;
        for (const auto& addr : addresses)
        {
            auto ip = addr.toString();
            if (ip.contains(".") && !ip.startsWith("127.") && !ip.startsWith("169.254."))
                cb.addItem(ip, idx++);
        }
        if (cb.getNumItems() > 0) cb.setSelectedId(1);
    };

    addAndMakeVisible(tcnetIfaceSelector);
    tcnetIfaceSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    tcnetIfaceSelector.setColour(juce::ComboBox::textColourId, C::tx);
    tcnetIfaceSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    populateIfaces(tcnetIfaceSelector);
    tcnetIfaceSelector.setVisible(false);

    addAndMakeVisible(pdjlIfaceSelector);
    pdjlIfaceSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    pdjlIfaceSelector.setColour(juce::ComboBox::textColourId, C::tx);
    pdjlIfaceSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    populateIfaces(pdjlIfaceSelector);
    pdjlIfaceSelector.setVisible(false);

    addAndMakeVisible(fpsSelector);
    fpsSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    fpsSelector.setColour(juce::ComboBox::textColourId, C::tx);
    fpsSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    fpsSelector.addItem("24 fps", 1);
    fpsSelector.addItem("25 fps", 2);
    fpsSelector.addItem("29.97 fps", 3);
    fpsSelector.addItem("30 fps", 4);
    fpsSelector.setSelectedId(2);
    fpsSelector.setVisible(false);

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
        C::grn2, 14.0f, 12.0f, C::grn, 42.0f, 40.0f, false));
    g.fillRoundedRectangle(10.0f, 12.0f, 28.0f, 28.0f, 6.0f);
    g.setColour(juce::Colour(0xff003825));
    g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
    g.drawText("B+", 10, 12, 28, 28, juce::Justification::centred);

    g.setColour(C::tx);
    g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
    g.drawText("BRIDGE+", 44, 12, 90, 15, juce::Justification::centredLeft);
    g.setColour(C::tx3);
    g.setFont(juce::FontOptions(9.0f));
    g.drawText("PRO DJ LINK", 44, 27, 90, 12, juce::Justification::centredLeft);

    // Status dot
    g.setColour(engine.isRunning() ? C::grn : C::tx4);
    g.fillEllipse(148.0f, 22.0f, 8.0f, 8.0f);

    // ── Tab bar (36px, y=52) ──
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

    // ── Status bar (24px, y=88) ──
    g.setColour(C::bg3);
    g.fillRect(0, 88, w, 24);
    g.setColour(C::bdr);
    g.drawHorizontalLine(112, 0, (float)w);

    // ── LINK tab: mode bar (32px, y=112) ──
    if (activeTab == TAB_LINK)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        g.drawText("DECK MODE", 10, 112, 80, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        if (visibleDecks == 0)
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(14.0f));
            g.drawText("Click \"+ DECK\" to add a virtual deck",
                getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26),
                juce::Justification::centred);
        }
    }

    // ── PRO DJ LINK tab ──
    if (activeTab == TAB_PDJL)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONNECTED DEVICES", 14, 112, 300, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // DJM fader panel
        auto djmArea = getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26).reduced(14, 8);
        g.setColour(C::bg2);
        g.fillRoundedRectangle(djmArea.toFloat(), 12.0f);
        g.setColour(C::bdr2);
        g.drawRoundedRectangle(djmArea.toFloat().reduced(0.5f), 12.0f, 1.0f);

        g.setColour(C::tx2);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("DJM Faders", djmArea.getX() + 12, djmArea.getY() + 10, 200, 20,
            juce::Justification::centredLeft);

        auto& djm = engine.getDJMStatus();
        for (int ch = 0; ch < 4; ch++)
        {
            int fx = djmArea.getX() + 20 + ch * 64;
            int fy = djmArea.getY() + 38;
            int fh = 100;
            g.setColour(C::bg4);
            g.fillRoundedRectangle((float)fx, (float)fy, 8.0f, (float)fh, 3.0f);
            int filledH = (int)(djm.faders[(size_t)ch] * (float)fh);
            g.setColour(C::grn.withAlpha(0.7f));
            g.fillRoundedRectangle((float)fx, (float)(fy + fh - filledH), 8.0f, (float)filledH, 3.0f);
            g.setColour(djm.onAir[(size_t)ch] ? C::grn : C::tx4);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText("CH" + juce::String(ch + 1), fx - 8, fy + fh + 6, 24, 14,
                juce::Justification::centred);
        }
    }

    // ── TCNet tab ──
    if (activeTab == TAB_TCNET)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("OUTPUT LAYERS (보류)", 14, 112, 300, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        g.setColour(C::tx3);
        g.setFont(juce::FontOptions(13.0f));
        g.drawText("TCNet 기능 구현 예정",
            getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26),
            juce::Justification::centred);
    }

    // ── Settings tab header ──
    if (activeTab == TAB_SETTINGS)
    {
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("CONFIGURATION", 14, 112, 300, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // Section header: TCNet
        auto sa = getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26).reduced(24, 0);
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText("TCNET", sa.getX(), sa.getY() + 4, 80, 16, juce::Justification::centredLeft);

        g.setColour(C::bdr2);
        g.drawHorizontalLine(sa.getY() + 12, (float)(sa.getX() + 50), (float)(sa.getRight()));

        // Section header: Pro DJ Link
        g.setColour(C::tx4);
        g.drawText("PRO DJ LINK", sa.getX(), sa.getY() + 100, 90, 16, juce::Justification::centredLeft);
        g.setColour(C::bdr2);
        g.drawHorizontalLine(sa.getY() + 108, (float)(sa.getX() + 96), (float)(sa.getRight()));
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

    // Mode bar / add deck button
    addDeckBtn.setBounds(w - 130, 115, 118, 26);

    // Bottom
    packetLabel.setBounds(w - 180, getHeight() - 24, 170, 22);

    if (activeTab == TAB_LINK)
        layoutDecks();
    else if (activeTab == TAB_SETTINGS)
        layoutSettings();
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
            if (!deckPanels[(size_t)i]) continue;
            int col = i % 2, row = i / 2;
            deckPanels[(size_t)i]->setBounds(
                area.getX() + col * (cellW + 8),
                area.getY() + row * (cellH + 8),
                cellW, cellH);
        }
    }
}

void MainComponent::layoutSettings()
{
    auto area = getLocalBounds();
    area.removeFromTop(168);
    area.removeFromBottom(26);
    area = area.reduced(24, 4);

    int rowH   = 28;
    int labelW = 170;
    int ctrlW  = 220;

    // TCNet section
    area.removeFromTop(16);  // section header space

    auto row1 = area.removeFromTop(rowH);
    nodeNameLabel.setBounds(row1.removeFromLeft(labelW));
    nodeNameEditor.setBounds(row1.removeFromLeft(ctrlW));
    area.removeFromTop(4);

    auto row2 = area.removeFromTop(rowH);
    tcnetIfaceLabel.setBounds(row2.removeFromLeft(labelW));
    tcnetIfaceSelector.setBounds(row2.removeFromLeft(ctrlW));
    area.removeFromTop(4);

    auto row3 = area.removeFromTop(rowH);
    fpsLabel.setBounds(row3.removeFromLeft(labelW));
    fpsSelector.setBounds(row3.removeFromLeft(ctrlW));
    area.removeFromTop(4);

    // Pro DJ Link section
    area.removeFromTop(24);  // section header space

    auto row4 = area.removeFromTop(rowH);
    pdjlIfaceLabel.setBounds(row4.removeFromLeft(labelW));
    pdjlIfaceSelector.setBounds(row4.removeFromLeft(ctrlW));
}

void MainComponent::timerCallback()
{
    if (engine.isRunning())
    {
        statusLabel.setText("RUNNING", juce::dontSendNotification);
        statusLabel.setColour(juce::Label::textColourId, C::grn);
        tcnetBadge.setText("TCNet: ONLINE",  juce::dontSendNotification);
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

    int activeCount = 0;
    for (int i = 0; i < 8; i++)
        if (engine.isVirtualDeckActive(i) || engine.isHWMode(i)) activeCount++;
    deckBadge.setText("Decks: " + juce::String(activeCount), juce::dontSendNotification);

    if (activeTab == TAB_LINK)
        for (int i = 0; i < visibleDecks; i++)
            if (deckPanels[(size_t)i]) deckPanels[(size_t)i]->updateDisplay();

    if (activeTab == TAB_PDJL || activeTab == TAB_TCNET)
        repaint();
}
