#include "MainComponent.h"

// ── Helpers ──────────────────────────────────
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

// ── Camelot Wheel key notation ──────────────────
static juce::String toCamelot(const juce::String& rawKey)
{
    if (rawKey.isEmpty()) return {};
    static const std::pair<const char*, const char*> kMap[] = {
        {"C","8B"},{"G","9B"},{"D","10B"},{"A","11B"},{"E","12B"},{"B","1B"},
        {"Cb","1B"},{"F#","2B"},{"Gb","2B"},{"C#","3B"},{"Db","3B"},
        {"G#","4B"},{"Ab","4B"},{"D#","5B"},{"Eb","5B"},{"A#","6B"},{"Bb","6B"},
        {"F","7B"},
        {"Am","8A"},{"Em","9A"},{"Bm","10A"},{"F#m","11A"},{"Gbm","11A"},
        {"C#m","12A"},{"Dbm","12A"},{"G#m","1A"},{"Abm","1A"},
        {"D#m","2A"},{"Ebm","2A"},{"A#m","3A"},{"Bbm","3A"},
        {"Fm","4A"},{"Cm","5A"},{"Gm","6A"},{"Dm","7A"},
    };

    // Already Camelot format?
    auto t = rawKey.trim();
    if (t.matchesWildcard("[0-9]A", true) || t.matchesWildcard("[0-9]B", true) ||
        t.matchesWildcard("1[0-2]A", true) || t.matchesWildcard("1[0-2]B", true))
        return t.toUpperCase();

    // Normalise "minor" suffix
    auto norm = t.replace(" minor", "m").replace(" Minor", "m").replace("min", "m").trimEnd();
    for (auto& [k, v] : kMap)
        if (norm.equalsIgnoreCase(k)) return juce::String(v) + " / " + t;
    return t;
}

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

/** Draw zoom waveform. headFrac = playhead position (0.5=center, 0.25=left) */
static void drawZoomWaveform(juce::Graphics& g,
    const juce::Rectangle<int>& bounds,
    const std::vector<DetailedWaveformPoint>& wf,
    float posMs, float durMs,
    float bpm, float windowMs = 4000.0f, float headFrac = 0.5f)
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

    // Show windowMs window, playhead at headFrac
    float startMs = posMs - windowMs * headFrac;
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

    // Playhead line at headFrac
    int cx = bounds.getX() + (int)(headFrac * (float)W);
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
    titleLabel.setMinimumHorizontalScale(0.01f);  // allow text to shrink

    // Artist label
    addAndMakeVisible(artistLabel);
    artistLabel.setFont(juce::FontOptions(10.0f));
    artistLabel.setColour(juce::Label::textColourId, C::tx3);
    artistLabel.setText("Load a track", juce::dontSendNotification);
    artistLabel.setMinimumHorizontalScale(0.01f);

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

    // ── REMOVE button (✕ top-right) ──
    addAndMakeVisible(removeBtn);
    removeBtn.setColour(juce::TextButton::buttonColourId,  juce::Colours::transparentBlack);
    removeBtn.setColour(juce::TextButton::textColourOffId, C::tx4);
    removeBtn.onClick = [this]
    {
        if (engine.isHWMode(deckNum)) return;
        if (onRemove) onRemove();
    };

    // ── Zoom buttons ──
    auto setupZoomBtn = [this](juce::TextButton& btn, const char* text)
    {
        addAndMakeVisible(btn);
        btn.setButtonText(text);
        btn.setColour(juce::TextButton::buttonColourId, juce::Colour(0x18ffffff));
        btn.setColour(juce::TextButton::textColourOffId, C::tx3);
    };
    setupZoomBtn(zoomInBtn,  "+");
    setupZoomBtn(zoomOutBtn, juce::CharPointer_UTF8("\xe2\x88\x92"));
    setupZoomBtn(zoomRstBtn, "RST");

    zoomInBtn.onClick  = [this] { zoomWindowMs = juce::jmax(500.0f,  zoomWindowMs * 0.5f); repaint(); };
    zoomOutBtn.onClick = [this] { zoomWindowMs = juce::jmin(16000.0f, zoomWindowMs * 2.0f); repaint(); };
    zoomRstBtn.onClick = [this] { zoomWindowMs = 4000.0f; repaint(); };
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

    // Overview waveform click → seek
    if (!engine.isHWMode(deckNum) && ovWfBounds.contains(e.getPosition()))
    {
        auto& deck = engine.getVirtualDeck(deckNum);
        if (deck.isLoaded() && deck.getDurationMs() > 0)
        {
            float t = juce::jlimit(0.0f, 1.0f,
                (float)(e.getPosition().x - ovWfBounds.getX()) / (float)ovWfBounds.getWidth());
            deck.seekTo(t * deck.getDurationMs());
            updateDisplay();
        }
        return;
    }

    // Zoom waveform drag-to-scrub
    if (!engine.isHWMode(deckNum) && zoomWfBounds.contains(e.getPosition()))
    {
        auto& deck = engine.getVirtualDeck(deckNum);
        if (deck.isLoaded())
        {
            draggingZoom   = true;
            dragStartX     = e.getPosition().x;
            dragStartPosMs = deck.getPositionMs();
        }
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

    if (draggingZoom)
    {
        draggingZoom = false;
        return;
    }

    Component::mouseUp(e);
}

void DeckPanel::mouseDrag(const juce::MouseEvent& e)
{
    if (draggingZoom && !engine.isHWMode(deckNum))
    {
        auto& deck = engine.getVirtualDeck(deckNum);
        if (deck.isLoaded() && zoomWfBounds.getWidth() > 0)
        {
            // px offset → ms: drag right = earlier (waveform follows finger)
            float msPerPx = zoomWindowMs / (float)zoomWfBounds.getWidth();
            float newMs = dragStartPosMs - (float)(e.getPosition().x - dragStartX) * msPerPx;
            newMs = juce::jlimit(0.0f, deck.getDurationMs(), newMs);
            deck.seekTo(newMs);
        }
        return;
    }
    Component::mouseDrag(e);
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

    // ── Shimmer line at top (2px, animated) ──
    bool isPlaying2 = (displayState == PlayState::PLAYING || displayState == PlayState::LOOPING);
    bool isCueing2  = (displayState == PlayState::CUED    || displayState == PlayState::CUEING);
    if (isPlaying2 || isCueing2)
    {
        // shimmerPhase drives 0.3→1.0→0.3 brightness cycle
        float brightness = 0.3f + 0.7f * (0.5f + 0.5f * std::sin(shimmerPhase * juce::MathConstants<float>::twoPi));
        juce::Colour shimBase = isPlaying2 ? C::grn : C::ylw.withAlpha(0.6f);
        juce::Colour shimCol  = shimBase.withAlpha(shimBase.getAlpha() * brightness);

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

    // ── Drag-over overlay ──
    if (dragOver)
    {
        g.setColour(C::blu.withAlpha(0.12f));
        g.fillRoundedRectangle(bounds, 12.0f);
        borderCol = C::blu.withAlpha(0.6f);
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

    // ── SYNC / MASTER badges (HW mode) ──
    if (isHW)
    {
        auto* ls = engine.getLayerState(deckNum);
        float bx = (float)getWidth() - 13.0f;
        float by = hdrY + 20.0f;
        // MASTER badge
        bool isMaster = ls && ls->master;
        float mw = 42.0f;
        bx -= mw;
        auto masterRect = juce::Rectangle<float>(bx, by, mw, 13.0f);
        g.setColour(isMaster ? C::org.withAlpha(0.18f) : juce::Colour(0x08ffffff));
        g.fillRoundedRectangle(masterRect, 2.0f);
        g.setColour(isMaster ? C::org : C::tx4);
        g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
        g.drawText("MASTER", masterRect, juce::Justification::centred);
        bx -= 4.0f;
        // SYNC badge
        bool isSync = ls && ls->sync;
        float sw = 36.0f;
        bx -= sw;
        auto syncRect = juce::Rectangle<float>(bx, by, sw, 13.0f);
        g.setColour(isSync ? C::blu.withAlpha(0.2f) : juce::Colour(0x08ffffff));
        g.fillRoundedRectangle(syncRect, 2.0f);
        g.setColour(isSync ? C::blu : C::tx4);
        g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
        g.drawText("SYNC", syncRect, juce::Justification::centred);
        // ON AIR badge
        bool isOnAir = ls && ls->onAir;
        if (isOnAir)
        {
            bx -= 4.0f;
            float ow = 42.0f;
            bx -= ow;
            auto onAirRect = juce::Rectangle<float>(bx, by, ow, 13.0f);
            g.setColour(C::red.withAlpha(0.18f));
            g.fillRoundedRectangle(onAirRect, 2.0f);
            g.setColour(C::red);
            g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
            g.drawText("ON AIR", onAirRect, juce::Justification::centred);
        }
    }

    // ── Album art ──
    if (!artBounds.isEmpty())
    {
        auto af = artBounds.toFloat();
        g.setColour(C::bgLo);
        g.fillRoundedRectangle(af, 8.0f);

        bool hasArt = false;
        if (!isHW)
        {
            const auto& art = deck.getAlbumArt();
            if (art.isValid())
            {
                g.saveState();
                juce::Path clipPath;
                clipPath.addRoundedRectangle(af, 8.0f);
                g.reduceClipRegion(clipPath);
                g.drawImage(art, af.toNearestInt().toFloat(),
                            juce::RectanglePlacement::centred | juce::RectanglePlacement::fillDestination);
                g.restoreState();
                hasArt = true;
            }
        }

        if (!hasArt)
        {
            // Placeholder: ♪ icon
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(22.0f));
            g.drawText(juce::CharPointer_UTF8("\xe2\x99\xaa"), artBounds, juce::Justification::centred);
        }

        g.setColour(C::bdr2);
        g.drawRoundedRectangle(af.reduced(0.5f), 8.0f, 1.0f);
    }

    // ── Overview waveform ──
    float posMs = deck.getPositionMs();
    float durMs = deck.getDurationMs();
    drawOverviewWaveform(g, ovWfBounds, deck.getWaveformData(), posMs, durMs);

    // ── Zoom waveform (leave 9px on right for VU meter) ──
    auto zoomWfDrawBounds = zoomWfBounds.withTrimmedRight(9);
    float headFrac = wfCenterLeftRef ? 0.25f : 0.5f;
    drawZoomWaveform(g, zoomWfDrawBounds, deck.getWaveformData(), posMs, durMs, deck.getBpm(), zoomWindowMs, headFrac);

    // ── Stereo VU meter (right edge of zoom wf area) ──
    if (!zoomWfBounds.isEmpty() && !isHW && deck.isLoaded())
    {
        float vuL = deck.getVuLeft();
        float vuR = deck.getVuRight();
        int vuX = zoomWfBounds.getRight() - 8;
        int vuY = zoomWfBounds.getY() + 2;
        int vuH = zoomWfBounds.getHeight() - 4;

        for (int ch = 0; ch < 2; ch++)
        {
            float level = (ch == 0) ? vuL : vuR;
            int bx = vuX + ch * 4;
            // Background
            g.setColour(juce::Colour(0x55000000));
            g.fillRoundedRectangle((float)bx, (float)vuY, 3.0f, (float)vuH, 1.5f);
            // Fill
            int fillH = (int)(level * (float)vuH);
            if (fillH > 0)
            {
                float topFrac = 1.0f - (float)fillH / (float)vuH;
                // Green base, yellow mid, red top
                juce::Colour fillCol = (level > 0.85f) ? C::red :
                                       (level > 0.6f)  ? C::ylw : C::grn2;
                g.setColour(fillCol.withAlpha(0.85f));
                g.fillRoundedRectangle((float)bx, (float)(vuY + vuH - fillH), 3.0f, (float)fillH, 1.5f);
                (void)topFrac;
            }
        }
    }

    // ── Bar.beat overlay on playhead (Electron style) ──
    if (!isHW && deck.isLoaded() && deck.getBpm() > 0 && !zoomWfDrawBounds.isEmpty())
    {
        float msPerBeat2 = 60000.0f / deck.getBpm();
        int beatInBar2   = (beatPhase / 64) + 1;  // 1~4
        int totalBeats2  = (msPerBeat2 > 0) ? (int)(posMs / msPerBeat2) : 0;
        int barNum2      = totalBeats2 / 4 + 1;
        juce::String barBeat = juce::String(barNum2) + "." + juce::String(beatInBar2);

        int cx2b = zoomWfDrawBounds.getX() + (int)(headFrac * (float)zoomWfDrawBounds.getWidth());
        g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
        float tbW = (float)(barBeat.length() * 7 + 8);
        auto tbRect = juce::Rectangle<float>((float)cx2b - tbW * 0.5f,
            (float)zoomWfDrawBounds.getY() + 3.0f, tbW, 15.0f);
        g.setColour(juce::Colour(0xc5000000));
        g.fillRoundedRectangle(tbRect, 2.0f);
        g.setColour(juce::Colour(0xff90d4ff));  // #90d4ff — Electron color
        g.drawText(barBeat, tbRect, juce::Justification::centred);
    }

    // Key badge (top-right of zoom waveform, shifted left to avoid VU meter)
    if (!isHW && !deck.getKey().isEmpty() && !zoomWfBounds.isEmpty())
    {
        juce::String keyStr = toCamelot(deck.getKey());
        float kw = (float)(keyStr.length() * 7 + 14);
        auto kr = juce::Rectangle<float>(
            (float)zoomWfBounds.getRight() - kw - 12,  // 12 = 9px VU + 3px gap
            (float)zoomWfBounds.getY() + 4,
            kw, 16.0f);
        g.setColour(juce::Colour(0xbf0c0e12));
        g.fillRoundedRectangle(kr, 3.0f);
        g.setColour(C::grn);
        g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
        g.drawText(keyStr, kr, juce::Justification::centred);
    }

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

            if (phasorScrollRef)
            {
                // Scroll mode: fill up to current beat
                if (playing && i <= curBeat)
                    g.setColour(i == curBeat ? C::grn.withAlpha(0.9f) : C::grn.withAlpha(0.45f));
                else
                    g.setColour(juce::Colour(0x0dffffff));
            }
            else
            {
                // Blink mode: only current beat lights up
                if (playing && i == curBeat)
                    g.setColour(C::grn.withAlpha(0.9f));
                else if (playing && i < curBeat)
                    g.setColour(C::grn.withAlpha(0.12f));
                else
                    g.setColour(juce::Colour(0x0dffffff));
            }
            g.fillRoundedRectangle(seg, 3.0f);
        }
    }

    // ── Progress bar row ──
    {
        float progDurMs = isHW
            ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->totalLengthMs : 0.0f)
            : deck.getDurationMs();
        float posMs2 = isHW
            ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->timecodeMs : 0.0f)
            : deck.getPositionMs();

        float prog = (progDurMs > 0) ? juce::jlimit(0.0f, 1.0f, posMs2 / progDurMs) : 0.0f;

        float prY = (float)(getHeight() - 28);
        float prX = 13.0f;
        float prW = (float)(getWidth() - 26);
        float prH = 3.0f;

        g.setColour(juce::Colour(0x0dffffff));
        g.fillRoundedRectangle(prX, prY, prW, prH, 1.5f);
        if (prog > 0.0f)
        {
            g.setGradientFill(juce::ColourGradient(
                C::pur, prX, prY,
                C::blu, prX + prW, prY, false));
            g.fillRoundedRectangle(prX, prY, prW * prog, prH, 1.5f);
        }

        // Duration label on right
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(9.0f));
        if (progDurMs > 0)
        {
            int totSec = (int)(progDurMs / 1000);
            juce::String dur = juce::String::formatted("%d:%02d", totSec / 60, totSec % 60);
            g.drawText(dur, (int)(prX + prW) - 36, (int)prY - 14, 36, 12,
                       juce::Justification::centredRight);
        }
    }

    // ── Bottom bar: HW/VIR | BPM | pos/dur ──
    float bpm2 = isHW
        ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->bpm : 0.0f)
        : deck.getBpm();

    int botY = getHeight() - 16;
    g.setColour(C::tx4);
    g.setFont(juce::FontOptions(9.0f));
    juce::String hwLabel = isHW
        ? juce::CharPointer_UTF8("\xe2\xac\xa1 HW")
        : juce::CharPointer_UTF8("\xe2\x97\x8e VIR");
    g.drawText(hwLabel, 13, botY, 44, 14, juce::Justification::centredLeft);

    if (bpm2 > 0.0f)
    {
        g.setColour(showBright ? C::tx2 : C::tx4);
        g.setFont(juce::FontOptions(10.0f, juce::Font::bold));

        // bar.beat — BPM (virtual deck only)
        if (!isHW && deck.isLoaded())
        {
            float msPerBeat = 60000.0f / bpm2;
            int beatInBar = (beatPhase / 64) + 1;  // 1~4
            int totalBeats = (msPerBeat > 0) ? (int)(posMs / msPerBeat) : 0;
            int barNum = totalBeats / 4 + 1;
            juce::String beatStr = juce::String(barNum) + "." + juce::String(beatInBar)
                + " \xe2\x80\x94 " + juce::String(bpm2, 1) + " BPM";
            g.drawText(beatStr, 13 + 46, botY, 120, 14, juce::Justification::centredLeft);
        }
        else
        {
            juce::String bpmStr = juce::String(bpm2, 1) + " BPM";
            g.drawText(bpmStr, 13 + 46, botY, 80, 14, juce::Justification::centredLeft);
        }
    }

    // pos / duration in mm:ss.xx format
    {
        float curMs2 = isHW
            ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->timecodeMs : 0.0f)
            : deck.getPositionMs();
        float totMs2 = isHW
            ? (engine.getLayerState(deckNum) ? engine.getLayerState(deckNum)->totalLengthMs : 0.0f)
            : deck.getDurationMs();

        auto fmtMmSs = [](float ms) -> juce::String {
            if (ms < 0) ms = 0;
            int totalCs = (int)(ms / 10);
            int m = totalCs / 6000; totalCs %= 6000;
            int s = totalCs / 100;  int cs = totalCs % 100;
            return juce::String::formatted("%d:%02d.%02d", m, s, cs);
        };

        juce::String posStr = fmtMmSs(curMs2) + " / " + fmtMmSs(totMs2);
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(9.0f));
        g.drawText(posStr, 13 + 170, botY, getWidth() - 13 - 170 - 10, 14,
                   juce::Justification::centredRight);
    }
}

void DeckPanel::resized()
{
    // Remove (✕) button: top-right corner
    removeBtn.setBounds(getWidth() - 22, 6, 16, 16);

    // Compact mode when deck panel is short (4+ decks)
    bool compact = (getHeight() < 220);

    auto area = getLocalBounds().reduced(13);
    area.removeFromTop(32);  // header (painted)
    area.removeFromBottom(20); // bottom label + phasor area

    // Track info labels
    titleLabel.setBounds(area.removeFromTop(compact ? 13 : 16));
    if (!compact) artistLabel.setBounds(area.removeFromTop(13));
    else          artistLabel.setBounds({});  // hidden in compact
    area.removeFromTop(compact ? 2 : 4);

    // Reserve bottom: LOAD/EJECT row + gap
    int loadBtnH = compact ? 20 : 26;
    auto bottomRow = area.removeFromBottom(loadBtnH);
    area.removeFromBottom(compact ? 3 : 5);

    // Reserve phasor
    int phasorH = compact ? 4 : 6;
    auto phasorRow = area.removeFromBottom(phasorH);
    area.removeFromBottom(compact ? 2 : 4);
    phasorBounds = phasorRow;

    // Art width (compact: 54px, full: 70px)
    int artW = compact ? 54 : 70;
    int artH = compact ? 54 : 70;

    // Content body: left column | gap | right column
    auto leftCol = area.removeFromLeft(artW);
    area.removeFromLeft(compact ? 4 : 6);
    auto rightCol = area;

    // Left column: art box + gap + [CUE][PLAY]
    artBounds = leftCol.removeFromTop(artH);
    leftCol.removeFromTop(compact ? 2 : 4);
    int btnH = compact ? 24 : 36;
    auto btnRow = leftCol.removeFromTop(btnH);
    int halfBW = (btnRow.getWidth() - 4) / 2;
    cueBtn.setBounds(btnRow.removeFromLeft(halfBW));
    btnRow.removeFromLeft(4);
    playBtn.setBounds(btnRow);

    // Right column: overview wf | gap | zoom wf | gap | zoom buttons
    int ovH = compact ? 12 : 18;
    ovWfBounds = rightCol.removeFromTop(ovH);
    rightCol.removeFromTop(compact ? 2 : 3);
    auto zoomBtnRow = rightCol.removeFromBottom(compact ? 12 : 16);
    rightCol.removeFromBottom(compact ? 1 : 2);
    zoomWfBounds = rightCol;

    // Zoom buttons
    int zbW = compact ? 18 : 22, zbGap = 2;
    int zbH = compact ? 10 : 14;
    zoomRstBtn.setBounds(zoomBtnRow.getRight() - zbW,               zoomBtnRow.getY(), zbW, zbH);
    zoomOutBtn.setBounds(zoomBtnRow.getRight() - zbW*2 - zbGap,     zoomBtnRow.getY(), zbW, zbH);
    zoomInBtn.setBounds( zoomBtnRow.getRight() - zbW*3 - zbGap*2,   zoomBtnRow.getY(), zbW, zbH);

    // Bottom row: LOAD | EJECT
    int bw2 = (bottomRow.getWidth() - 4) / 2;
    loadBtn.setBounds(bottomRow.removeFromLeft(bw2));
    bottomRow.removeFromLeft(4);
    ejectBtn.setBounds(bottomRow);
}

bool DeckPanel::isInterestedInFileDrag(const juce::StringArray& files)
{
    if (engine.isHWMode(deckNum)) return false;
    for (auto& f : files)
    {
        juce::String ext = juce::File(f).getFileExtension().toLowerCase();
        if (ext == ".mp3" || ext == ".wav" || ext == ".flac" ||
            ext == ".aiff" || ext == ".aif" || ext == ".m4a" ||
            ext == ".aac"  || ext == ".ogg")
            return true;
    }
    return false;
}

void DeckPanel::filesDropped(const juce::StringArray& files, int, int)
{
    dragOver = false;
    if (engine.isHWMode(deckNum) || files.isEmpty()) return;
    auto file = juce::File(files[0]);
    if (!file.existsAsFile()) return;
    sLastDir = file.getParentDirectory();
    auto& deck = engine.getVirtualDeck(deckNum);
    if (deck.loadFile(file))
    {
        engine.setVirtualDeckActive(deckNum, true);
        updateDisplay();
    }
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

    // Advance shimmer animation (20Hz timer → ~2s cycle)
    shimmerPhase = std::fmod(shimmerPhase + 0.025f, 1.0f);

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
            modeToggleBtn.setVisible(showDecks);
            for (int s = 0; s < 3; s++)
            {
                outSrcSelectors[(size_t)s].setVisible(showDecks);
                outOffsetEditors[(size_t)s].setVisible(showDecks);
                for (int m = 0; m < 3; m++)
                    outModeBtns[(size_t)s][(size_t)m].setVisible(showDecks);
            }

            // Settings visibility
            bool showSettings = (activeTab == TAB_SETTINGS);
            auto setSettingsVis = [&](juce::Component& c) { c.setVisible(showSettings); };
            setSettingsVis(nodeNameLabel);    setSettingsVis(nodeNameEditor);
            setSettingsVis(tcnetIfaceLabel);  setSettingsVis(tcnetIfaceSelector);
            setSettingsVis(pdjlIfaceLabel);   setSettingsVis(pdjlIfaceSelector);
            setSettingsVis(fpsLabel);         setSettingsVis(fpsSelector);
            setSettingsVis(tcnetModeLabel);   setSettingsVis(tcnetModeSelector);
            setSettingsVis(wfCenterLabel);    setSettingsVis(wfCenterSelector);
            setSettingsVis(phasorModeLabel);  setSettingsVis(phasorModeSelector);
            setSettingsVis(audioOutLabel);    setSettingsVis(audioOutSelector);
            setSettingsVis(tcFpsLabel);       setSettingsVis(tcFpsSelector);
            setSettingsVis(ltcALabel);        setSettingsVis(ltcASelector);
            setSettingsVis(ltcBLabel);        setSettingsVis(ltcBSelector);
            setSettingsVis(ltcMLabel);        setSettingsVis(ltcMSelector);
            setSettingsVis(artnetIpLabel);    setSettingsVis(artnetIpEditor);
            setSettingsVis(artnetPortLabel);  setSettingsVis(artnetPortEditor);

            // Populate audio devices list lazily
            if (showSettings && audioOutSelector.getNumItems() <= 1)
            {
                auto* devType = deviceManager.getCurrentDeviceTypeObject();
                if (devType)
                {
                    auto devNames = devType->getDeviceNames(false);
                    for (int di = 0; di < devNames.size(); di++)
                    {
                        audioOutSelector.addItem(devNames[di], di + 2);
                        ltcASelector.addItem(devNames[di], di + 2);
                        ltcBSelector.addItem(devNames[di], di + 2);
                        ltcMSelector.addItem(devNames[di], di + 2);
                    }
                }
            }

            resized();
            repaint();
        };
    }

    // Status bar values are drawn as pills in paint()

    // ── Output Layer source selectors ──
    // Output layer source selectors
    // Layer A (i=0) and B (i=1): deck slots only
    // Layer M (i=2): Layer A (-10), Layer B (-11), or deck slots
    for (int i = 0; i < 3; i++)
    {
        addAndMakeVisible(outSrcSelectors[(size_t)i]);
        outSrcSelectors[(size_t)i].setColour(juce::ComboBox::backgroundColourId, C::bg3);
        outSrcSelectors[(size_t)i].setColour(juce::ComboBox::textColourId, C::tx3);
        outSrcSelectors[(size_t)i].setColour(juce::ComboBox::outlineColourId, C::bdr2);
        outSrcSelectors[(size_t)i].addItem("—", 1);
        if (i == 2)
        {
            // M layer: can also use Layer A or B as source
            outSrcSelectors[(size_t)i].addItem("Layer A", 2);
            outSrcSelectors[(size_t)i].addItem("Layer B", 3);
        }
        int baseId = (i == 2) ? 10 : 2;
        for (int d = 0; d < kMaxDecks; d++)
            outSrcSelectors[(size_t)i].addItem("Deck " + juce::String(d + 1), baseId + d);
        outSrcSelectors[(size_t)i].setSelectedId(1);
        outSrcSelectors[(size_t)i].setVisible(false); // starts hidden, shown on TAB_LINK
        outSrcSelectors[(size_t)i].onChange = [this, i]
        {
            int sel = outSrcSelectors[(size_t)i].getSelectedId();
            if (sel <= 1)
                outLayers[(size_t)i].srcSlot = -1;
            else if (i == 2 && sel == 2)
                outLayers[(size_t)i].srcSlot = -10;  // Layer A
            else if (i == 2 && sel == 3)
                outLayers[(size_t)i].srcSlot = -11;  // Layer B
            else
            {
                int baseId = (i == 2) ? 10 : 2;
                outLayers[(size_t)i].srcSlot = sel - baseId;
            }
        };
    }

    // ── Output mode buttons (LTC/MTC/ART × 3 layers) ──
    {
        const char* modeLabels[] = { "LTC", "MTC", "ART" };
        const juce::Colour modeColors[] = { C::ylw, C::blu, C::org };
        for (int i = 0; i < 3; i++)
        {
            for (int m = 0; m < 3; m++)
            {
                auto& btn = outModeBtns[(size_t)i][(size_t)m];
                btn.setButtonText(modeLabels[m]);
                addAndMakeVisible(btn);
                btn.setColour(juce::TextButton::buttonColourId,   juce::Colours::transparentBlack);
                btn.setColour(juce::TextButton::textColourOffId,  C::tx4);
                btn.setColour(juce::TextButton::buttonOnColourId, modeColors[(size_t)m].withAlpha(0.2f));
                btn.setColour(juce::TextButton::textColourOnId,   modeColors[(size_t)m]);
                btn.setClickingTogglesState(true);
                btn.setVisible(false);  // shown on TAB_LINK
                btn.onClick = [this, i, m]
                {
                    bool on = outModeBtns[(size_t)i][(size_t)m].getToggleState();
                    if (m == 0) outLayers[(size_t)i].ltc = on;
                    else if (m == 1) outLayers[(size_t)i].mtc = on;
                    else             outLayers[(size_t)i].art = on;
                    repaint();
                };
            }
        }
    }

    // ── Output Layer offset editors ──
    for (int i = 0; i < 3; i++)
    {
        auto& ed = outOffsetEditors[(size_t)i];
        addAndMakeVisible(ed);
        ed.setColour(juce::TextEditor::backgroundColourId, C::bg4);
        ed.setColour(juce::TextEditor::textColourId, C::tx3);
        ed.setColour(juce::TextEditor::outlineColourId, C::bdr2);
        ed.setText("0", juce::dontSendNotification);
        ed.setInputRestrictions(6, "0123456789-");
        ed.setJustification(juce::Justification::centred);
        ed.setVisible(false);
        ed.onTextChange = [this, i]
        {
            outLayers[(size_t)i].offsetMs = outOffsetEditors[(size_t)i].getText().getIntValue();
        };
    }

    // ── Mode Toggle (VIR / HW) — transparent overlay over painted toggle ──
    addAndMakeVisible(modeToggleBtn);
    modeToggleBtn.setColour(juce::TextButton::buttonColourId, juce::Colours::transparentBlack);
    modeToggleBtn.setColour(juce::TextButton::textColourOffId, juce::Colours::transparentBlack);
    modeToggleBtn.onClick = [this]
    {
        globalHWMode = !globalHWMode;
        repaint();
    };

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

    // ── TCNet Mode selector ──
    setupSettingsLabel(tcnetModeLabel, "TCNet 모드");
    addAndMakeVisible(tcnetModeSelector);
    tcnetModeSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    tcnetModeSelector.setColour(juce::ComboBox::textColourId, C::tx);
    tcnetModeSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    tcnetModeSelector.addItem("Auto", 1);
    tcnetModeSelector.addItem("Server", 2);
    tcnetModeSelector.addItem("Client", 3);
    tcnetModeSelector.setSelectedId(1);
    tcnetModeSelector.setVisible(false);

    // ── Waveform center selector ──
    setupSettingsLabel(wfCenterLabel, "플레이헤드 위치");
    addAndMakeVisible(wfCenterSelector);
    wfCenterSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    wfCenterSelector.setColour(juce::ComboBox::textColourId, C::tx);
    wfCenterSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    wfCenterSelector.addItem("중앙 (Center)", 1);
    wfCenterSelector.addItem("좌측 (Left 25%)", 2);
    wfCenterSelector.setSelectedId(1);
    wfCenterSelector.setVisible(false);
    wfCenterSelector.onChange = [this]
    {
        wfCenterLeft = (wfCenterSelector.getSelectedId() == 2);
        repaint();
    };

    // ── Phasor mode selector ──
    setupSettingsLabel(phasorModeLabel, "비트 페이저 모드");
    addAndMakeVisible(phasorModeSelector);
    phasorModeSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    phasorModeSelector.setColour(juce::ComboBox::textColourId, C::tx);
    phasorModeSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    phasorModeSelector.addItem("Static (기본)", 1);
    phasorModeSelector.addItem("Scroll (채우기)", 2);
    phasorModeSelector.setSelectedId(1);
    phasorModeSelector.setVisible(false);
    phasorModeSelector.onChange = [this]
    {
        phasorScroll = (phasorModeSelector.getSelectedId() == 2);
        repaint();
    };

    // ── Audio output selector ──
    setupSettingsLabel(audioOutLabel, "오디오 출력 장치");
    addAndMakeVisible(audioOutSelector);
    audioOutSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    audioOutSelector.setColour(juce::ComboBox::textColourId, C::tx);
    audioOutSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    audioOutSelector.addItem("시스템 기본", 1);
    // Device list populated lazily when settings tab is shown
    audioOutSelector.setSelectedId(1);
    audioOutSelector.setVisible(false);

    // ── SMPTE 타임코드 출력 ──
    setupSettingsLabel(tcFpsLabel,      "프레임레이트");
    setupSettingsLabel(ltcALabel,       "LTC — Layer A 장치");
    setupSettingsLabel(ltcBLabel,       "LTC — Layer B 장치");
    setupSettingsLabel(ltcMLabel,       "LTC — Layer M 장치");
    setupSettingsLabel(artnetIpLabel,   "ArtNet 대상 IP");
    setupSettingsLabel(artnetPortLabel, "ArtNet 포트");

    addAndMakeVisible(tcFpsSelector);
    tcFpsSelector.setColour(juce::ComboBox::backgroundColourId, C::bg3);
    tcFpsSelector.setColour(juce::ComboBox::textColourId, C::tx);
    tcFpsSelector.setColour(juce::ComboBox::outlineColourId, C::bdr2);
    tcFpsSelector.addItem("24 fps", 1);
    tcFpsSelector.addItem("25 fps", 2);
    tcFpsSelector.addItem("29.97 fps", 3);
    tcFpsSelector.addItem("30 fps", 4);
    tcFpsSelector.setSelectedId(2);
    tcFpsSelector.setVisible(false);

    auto setupLtcSelector = [this](juce::ComboBox& cb)
    {
        addAndMakeVisible(cb);
        cb.setColour(juce::ComboBox::backgroundColourId, C::bg3);
        cb.setColour(juce::ComboBox::textColourId, C::tx);
        cb.setColour(juce::ComboBox::outlineColourId, C::bdr2);
        cb.addItem("시스템 기본", 1);
        cb.setSelectedId(1);
        cb.setVisible(false);
    };
    setupLtcSelector(ltcASelector);
    setupLtcSelector(ltcBSelector);
    setupLtcSelector(ltcMSelector);

    addAndMakeVisible(artnetIpEditor);
    artnetIpEditor.setColour(juce::TextEditor::backgroundColourId, C::bg3);
    artnetIpEditor.setColour(juce::TextEditor::textColourId, C::tx);
    artnetIpEditor.setColour(juce::TextEditor::outlineColourId, C::bdr2);
    artnetIpEditor.setText("255.255.255.255");
    artnetIpEditor.setVisible(false);

    addAndMakeVisible(artnetPortEditor);
    artnetPortEditor.setColour(juce::TextEditor::backgroundColourId, C::bg3);
    artnetPortEditor.setColour(juce::TextEditor::textColourId, C::tx);
    artnetPortEditor.setColour(juce::TextEditor::outlineColourId, C::bdr2);
    artnetPortEditor.setText("6454");
    artnetPortEditor.setInputRestrictions(5, "0123456789");
    artnetPortEditor.setVisible(false);

    // Populate LTC device list lazily (same as audio out)

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

void MainComponent::removeDeck(int slot)
{
    if (slot < 0 || slot >= visibleDecks) return;
    // Eject the deck
    engine.getVirtualDeck(slot).eject();
    engine.setVirtualDeckActive(slot, false);
    // Shift panels left
    for (int i = slot; i < visibleDecks - 1; i++)
    {
        if (deckPanels[(size_t)i] && deckPanels[(size_t)(i + 1)])
        {
            // swap to shift deck data left (slot numbers differ; simplest: hide and rebuild)
        }
        deckPanels[(size_t)i] = std::move(deckPanels[(size_t)(i + 1)]);
        if (deckPanels[(size_t)i])
            deckPanels[(size_t)i]->setDeckNum(i);
    }
    deckPanels[(size_t)(visibleDecks - 1)].reset();
    visibleDecks--;
    addDeckBtn.setEnabled(true);
    layoutDecks();
    repaint();
}

void MainComponent::addDeck()
{
    if (visibleDecks >= kMaxDecks) return;
    int idx = visibleDecks;
    if (!deckPanels[(size_t)idx])
    {
        deckPanels[(size_t)idx] = std::make_unique<DeckPanel>(idx, engine);
        deckPanels[(size_t)idx]->onRemove = [this, idx] { removeDeck(idx); };
        addAndMakeVisible(deckPanels[(size_t)idx].get());
    }
    else
    {
        deckPanels[(size_t)idx]->setVisible(true);
    }
    visibleDecks++;
    layoutDecks();
    repaint();
    if (visibleDecks >= kMaxDecks) addDeckBtn.setEnabled(false);
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

    // ── Status bar pills (24px, y=88) ──
    g.setColour(C::bg3);
    g.fillRect(0, 88, w, 24);
    g.setColour(C::bdr);
    g.drawHorizontalLine(112, 0, (float)w);

    // Draw pill badges
    struct PillDef { juce::String label; juce::String value; juce::Colour valCol; bool highlight; };
    PillDef pills[] = {
        { "TCNet",      statusTCNet,  tcnetOnline ? C::blu : C::red,   tcnetOnline },
        { "ARENA 노드", statusArena,  C::blu,   false },
        { "활성 덱",    statusDecks,  C::tx2,   false },
        { "UPTIME",     statusUptime, C::tx2,   false },
    };
    float px = 10.0f;
    for (auto& p : pills)
    {
        float pillW = (float)(p.label.length() * 5 + p.value.length() * 7 + 28);
        auto pillRect = juce::Rectangle<float>(px, 92.0f, pillW, 16.0f);
        // Background
        g.setColour(p.highlight
            ? juce::Colour(0x0a00563b)
            : C::bg4);
        g.fillRoundedRectangle(pillRect, 999.0f);
        // Label text
        g.setColour(C::tx3);
        g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
        float lblW = (float)(p.label.length() * 5 + 4);
        g.drawText(p.label, (int)px + 7, 92, (int)lblW, 16, juce::Justification::centredLeft);
        // Value text
        g.setColour(p.valCol);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText(p.value, (int)(px + 7 + lblW + 2), 92, (int)(p.value.length() * 7 + 4), 16,
                   juce::Justification::centredLeft);
        px += pillW + 6;
    }

    // ── LINK tab: OUTPUT LAYERS (y=112, h=80) + mode bar (y=192) ──
    if (activeTab == TAB_LINK)
    {
        // Section label
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText("OUTPUT LAYERS", 12, 114, 120, 14, juce::Justification::centredLeft);

        // A / B / M cards
        const char* lNames[] = { "A", "B", "M" };
        const juce::Colour lColors[] = { C::grn, C::blu, C::pur };
        int cardW = (w - 28) / 3;
        for (int i = 0; i < 3; i++)
        {
            int cx = 12 + i * (cardW + 4);
            int cy = 128;
            int ch = 72;
            auto cr = juce::Rectangle<float>((float)cx, (float)cy, (float)cardW, (float)ch);

            // Get source slot timecode
            // srcSlot: -1=none, -10=LayerA, -11=LayerB, 0-5=deck slot
            int srcSlot = outLayers[(size_t)i].srcSlot;
            float tcMs = 0.0f;
            bool playing = false;

            // M layer: redirect to Layer A or B source
            int resolvedSlot = srcSlot;
            if (srcSlot == -10)       resolvedSlot = outLayers[0].srcSlot;  // Layer A src
            else if (srcSlot == -11)  resolvedSlot = outLayers[1].srcSlot;  // Layer B src

            if (resolvedSlot >= 0 && resolvedSlot < visibleDecks)
            {
                if (engine.isHWMode(resolvedSlot))
                {
                    auto* ls = engine.getLayerState(resolvedSlot);
                    if (ls) { tcMs = ls->timecodeMs; playing = (ls->state == PlayState::PLAYING); }
                }
                else
                {
                    auto& deck = engine.getVirtualDeck(resolvedSlot);
                    tcMs = deck.getPositionMs();
                    playing = (deck.getState() == PlayState::PLAYING);
                }
            }

            g.setColour(playing ? C::bg2.brighter(0.05f) : C::bg2);
            g.fillRoundedRectangle(cr, 8.0f);
            if (playing)
            {
                g.setColour(lColors[i].withAlpha(0.08f));
                g.fillRoundedRectangle(cr, 8.0f);
            }
            g.setColour(playing ? lColors[i].withAlpha(0.4f) : C::bdr);
            g.drawRoundedRectangle(cr.reduced(0.5f), 8.0f, 1.0f);

            // Badge
            auto badgeRect = juce::Rectangle<float>((float)cx + 8, (float)cy + 8, 18.0f, 18.0f);
            g.setColour(lColors[i]);
            g.fillRoundedRectangle(badgeRect, 4.0f);
            g.setColour(C::bgLo);
            g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
            g.drawText(lNames[i], badgeRect, juce::Justification::centred);

            // Timecode
            g.setColour(playing ? C::tx : C::tx4);
            g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
            g.drawText(formatTimecode(tcMs), cx + 30, cy + 6, cardW - 38, 18,
                       juce::Justification::centredRight);

            // LTC/MTC/ART toggle buttons + OFFSET editor are real juce controls (positioned in resized())
            // OFFSET label (painted, not a component)
            if (activeTab == TAB_LINK)
            {
                int lx = 12 + i * (cardW + 4);
                g.setColour(C::tx4);
                g.setFont(juce::FontOptions(8.0f));
                g.drawText("OFFSET ms", lx + 8, 196, 60, 11, juce::Justification::centredLeft);
            }
        }
    }
    if (activeTab == TAB_LINK)
    {
        g.setColour(C::bg);
        g.fillRect(0, 208, w, 32);

        // "DECK MODE" label
        g.setColour(C::tx4);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText("DECK MODE", 10, 208, 80, 32, juce::Justification::centredLeft);

        // VIR / HW toggle (drawn manually)
        int toggleX = 96;
        int toggleY = 214;
        // Outer pill
        g.setColour(C::bgLo);
        g.fillRoundedRectangle((float)toggleX, (float)toggleY, 120.0f, 20.0f, 5.0f);
        g.setColour(C::bdr2);
        g.drawRoundedRectangle((float)toggleX, (float)toggleY, 120.0f, 20.0f, 5.0f, 1.0f);
        // Active segment
        bool hwActive = globalHWMode;
        if (!hwActive)
        {
            g.setColour(C::bg4);
            g.fillRoundedRectangle((float)toggleX + 2, (float)toggleY + 2, 58.0f, 16.0f, 4.0f);
        }
        else
        {
            g.setColour(C::bg4);
            g.fillRoundedRectangle((float)toggleX + 60, (float)toggleY + 2, 58.0f, 16.0f, 4.0f);
        }
        // Labels
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.setColour(!hwActive ? C::grn : C::tx.withAlpha(0.4f));
        g.drawText("VIRTUAL", toggleX, toggleY, 62, 20, juce::Justification::centred);
        g.setColour(hwActive ? C::grn : C::tx.withAlpha(0.4f));
        g.drawText("HARDWARE", toggleX + 60, toggleY, 60, 20, juce::Justification::centred);

        g.setColour(C::bdr);
        g.drawHorizontalLine(242, 0, (float)w);

        // Alert banner (when not running)
        if (!engine.isRunning())
        {
            auto alertArea = getLocalBounds().withTrimmedTop(246).withTrimmedBottom(26).reduced(12, 6);
            auto bannerRect = alertArea.removeFromTop(36);
            g.setColour(juce::Colour(0x14ecb210)); // ylw2 tint
            g.fillRoundedRectangle(bannerRect.toFloat(), 8.0f);
            g.setColour(juce::Colour(0x26ecb210));
            g.drawRoundedRectangle(bannerRect.toFloat().reduced(0.5f), 8.0f, 1.0f);
            // dot
            g.setColour(C::ylw);
            g.fillEllipse((float)(bannerRect.getX() + 12), (float)(bannerRect.getCentreY() - 3), 6.0f, 6.0f);
            g.setColour(C::ylw);
            g.setFont(juce::FontOptions(11.0f));
            g.drawText("START를 눌러 TCNet을 시작하세요",
                bannerRect.getX() + 26, bannerRect.getY(), bannerRect.getWidth() - 28, bannerRect.getHeight(),
                juce::Justification::centredLeft);
        }

        // Section label above decks
        g.setColour(C::tx3);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        juce::String sectionLabel = globalHWMode
            ? "INPUT LAYERS \xe2\x80\x94 CDJ / HW"
            : "INPUT LAYERS \xe2\x80\x94 VIRTUAL";
        g.drawText(sectionLabel, 12, 244, 300, 16, juce::Justification::centredLeft);

        if (visibleDecks == 0)
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(13.0f));
            g.drawText("+ DECK 버튼으로 Virtual 덱을 추가하세요",
                getLocalBounds().withTrimmedTop(260).withTrimmedBottom(26),
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
        g.drawText("기기 목록", 14, 112, 300, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        // PDJL status banner
        {
            int pdjlPort = engine.getPDJLPort();
            auto bannerRect = juce::Rectangle<float>(14.0f, 150.0f, (float)(w - 28), 28.0f);
            g.setColour(pdjlPort ? C::grn2.withAlpha(0.08f) : C::red.withAlpha(0.08f));
            g.fillRoundedRectangle(bannerRect, 6.0f);
            g.setColour(pdjlPort ? C::grn2.withAlpha(0.25f) : C::red.withAlpha(0.2f));
            g.drawRoundedRectangle(bannerRect.reduced(0.5f), 6.0f, 1.0f);
            g.setColour(pdjlPort ? C::grn : C::red);
            g.fillEllipse(bannerRect.getX() + 10, bannerRect.getCentreY() - 3, 6.0f, 6.0f);
            g.setColour(pdjlPort ? C::grn : C::red);
            g.setFont(juce::FontOptions(11.0f));
            juce::String pdjlTxt = pdjlPort
                ? "Pro DJ Link — UDP " + juce::String(pdjlPort) + " 수신 중"
                : "Pro DJ Link — 비활성 (START 필요)";
            g.drawText(pdjlTxt, (int)(bannerRect.getX() + 24), (int)bannerRect.getY(),
                (int)(bannerRect.getWidth() - 26), (int)bannerRect.getHeight(),
                juce::Justification::centredLeft);
        }

        auto contentArea = getLocalBounds().withTrimmedTop(184).withTrimmedBottom(26).reduced(14, 4);
        int itemY = contentArea.getY();
        const int itemH = 52;
        const int itemGap = 6;

        // Device bar - shows all connected CDJ/DJM devices
        auto& devs = engine.getDevices();
        auto now = juce::Time::currentTimeMillis();
        bool anyDevice = false;

        for (auto& [key, dev] : devs)
        {
            if (now - dev.lastSeen > 15000) continue;
            anyDevice = true;

            // Device row card
            auto rowRect = juce::Rectangle<int>(contentArea.getX(), itemY, contentArea.getWidth(), itemH);
            g.setColour(C::bg2);
            g.fillRoundedRectangle(rowRect.toFloat(), 10.0f);
            g.setColour(C::bdr);
            g.drawRoundedRectangle(rowRect.toFloat().reduced(0.5f), 10.0f, 1.0f);

            // Icon box
            bool isCDJ = dev.type == "CDJ";
            auto iconRect = juce::Rectangle<float>((float)rowRect.getX() + 10, (float)rowRect.getY() + 12,
                                                    28.0f, 28.0f);
            g.setColour(isCDJ ? C::grn.withAlpha(0.1f) : C::pur.withAlpha(0.1f));
            g.fillRoundedRectangle(iconRect, 4.0f);
            g.setColour(isCDJ ? C::grn : C::pur);
            g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
            g.drawText(isCDJ ? "CDJ" : "DJM", iconRect, juce::Justification::centred);

            // Device name
            g.setColour(C::tx2);
            g.setFont(juce::FontOptions(11.0f, juce::Font::plain));
            g.drawText(dev.name.isEmpty() ? dev.type : dev.name,
                rowRect.getX() + 46, rowRect.getY() + 8, 200, 16,
                juce::Justification::centredLeft);

            // IP
            g.setColour(C::tx3);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText(dev.ip, rowRect.getX() + 46, rowRect.getY() + 26, 200, 14,
                juce::Justification::centredLeft);

            // Player number badge
            if (dev.playerNum > 0)
            {
                auto badgeR = juce::Rectangle<float>((float)rowRect.getRight() - 40,
                    (float)rowRect.getY() + 14, 28.0f, 24.0f);
                g.setColour(C::bg4);
                g.fillRoundedRectangle(badgeR, 4.0f);
                g.setColour(C::tx3);
                g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
                g.drawText("#" + juce::String(dev.playerNum), badgeR, juce::Justification::centred);
            }

            itemY += itemH + itemGap;
            if (itemY > contentArea.getBottom() - itemH) break;
        }

        if (!anyDevice)
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(13.0f));
            g.drawText("Pro DJ Link 기기가 감지되지 않았습니다",
                contentArea, juce::Justification::centred);
        }

        // DJM fader strip at bottom
        auto& djm = engine.getDJMStatus();
        int stripY = getHeight() - 26 - 70;
        int stripX = contentArea.getX();
        int stripW = contentArea.getWidth();

        g.setColour(C::bg2);
        g.fillRoundedRectangle((float)stripX, (float)stripY, (float)stripW, 60.0f, 8.0f);
        g.setColour(C::bdr);
        g.drawRoundedRectangle((float)stripX, (float)stripY, (float)stripW, 60.0f, 8.0f, 1.0f);

        g.setColour(C::tx3);
        g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
        g.drawText("DJM FADERS", stripX + 10, stripY + 4, 100, 14, juce::Justification::centredLeft);

        for (int ch = 0; ch < 4; ch++)
        {
            int fx = stripX + 10 + ch * 60;
            int fy = stripY + 22;
            int fh = 28;
            g.setColour(C::bg4);
            g.fillRoundedRectangle((float)fx, (float)fy, 6.0f, (float)fh, 2.0f);
            int filledH = (int)(djm.faders[(size_t)ch] * (float)fh);
            g.setColour(djm.onAir[(size_t)ch] ? C::grn.withAlpha(0.8f) : C::grn.withAlpha(0.4f));
            g.fillRoundedRectangle((float)fx, (float)(fy + fh - filledH), 6.0f, (float)filledH, 2.0f);
            g.setColour(djm.onAir[(size_t)ch] ? C::grn : C::tx4);
            g.setFont(juce::FontOptions(9.0f));
            g.drawText("CH" + juce::String(ch + 1), fx - 6, fy + fh + 2, 18, 12,
                juce::Justification::centred);
        }
    }

    // ── TCNet tab ──
    if (activeTab == TAB_TCNET)
    {
        // Sub-header
        g.setColour(C::bg);
        g.fillRect(0, 112, w, 32);
        g.setColour(C::tx);
        g.setFont(juce::FontOptions(12.0f, juce::Font::bold));
        g.drawText("TCNet 네트워크", 14, 112, 300, 32, juce::Justification::centredLeft);
        g.setColour(C::bdr);
        g.drawHorizontalLine(144, 0, (float)w);

        auto contentArea = getLocalBounds().withTrimmedTop(152).withTrimmedBottom(26).reduced(14, 4);
        int cy = contentArea.getY();
        int cx2 = contentArea.getX();
        int cw  = contentArea.getWidth();

        // ── Connection status banner ──
        {
            bool online = engine.isRunning();
            auto bannerRect = juce::Rectangle<float>((float)cx2, (float)cy, (float)cw, 32.0f);
            g.setColour(online ? C::grn2.withAlpha(0.1f) : juce::Colour(0x14ecb210));
            g.fillRoundedRectangle(bannerRect, 8.0f);
            g.setColour(online ? C::grn2.withAlpha(0.3f) : juce::Colour(0x26ecb210));
            g.drawRoundedRectangle(bannerRect.reduced(0.5f), 8.0f, 1.0f);

            float dotX2 = (float)cx2 + 12.0f;
            float dotY2 = (float)cy + 13.0f;
            g.setColour(online ? C::grn : C::ylw);
            g.fillEllipse(dotX2, dotY2, 7.0f, 7.0f);

            g.setColour(online ? C::grn : C::ylw);
            g.setFont(juce::FontOptions(11.0f, juce::Font::bold));
            g.drawText(online ? "TCNet ONLINE" : "TCNet OFFLINE — START를 눌러 시작하세요",
                cx2 + 28, cy + 2, cw - 30, 28, juce::Justification::centredLeft);

            if (online)
            {
                g.setColour(C::tx3);
                g.setFont(juce::FontOptions(10.0f));
                juce::String info = "노드 " + juce::String(engine.getNodeCount())
                    + "개  |  TX " + juce::String(engine.getPacketCount()) + " pkts"
                    + "  |  " + formatUptime(engine.getUptimeSeconds());
                g.drawText(info, cx2, cy + 2, cw - 10, 28, juce::Justification::centredRight);
            }
            cy += 40;
        }

        // ── Statistics grid ──
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
            g.drawText("패킷 통계", cx2, cy, 100, 14, juce::Justification::centredLeft);
            cy += 16;

            struct StatCard { juce::String label; juce::String type; int count; juce::Colour col; };
            StatCard stats[] = {
                { "TIME",   "0xFE", engine.getTimePacketCount(),   C::blu },
                { "DATA",   "0xC8", engine.getDataPacketCount(),   C::grn },
                { "OPTIN",  "0x02", engine.getOptInPacketCount(),  C::ylw },
                { "STATUS", "0x05", engine.getStatusPacketCount(), C::pur },
            };

            int cardW2 = (cw - 18) / 4;
            for (int i = 0; i < 4; i++)
            {
                int scx = cx2 + i * (cardW2 + 6);
                auto sr = juce::Rectangle<float>((float)scx, (float)cy, (float)cardW2, 44.0f);
                g.setColour(C::bg2);
                g.fillRoundedRectangle(sr, 6.0f);
                g.setColour(C::bdr);
                g.drawRoundedRectangle(sr.reduced(0.5f), 6.0f, 1.0f);

                // Type badge
                float tbw = (float)(stats[i].type.length() * 6 + 10);
                auto tbr = juce::Rectangle<float>((float)scx + 6, (float)cy + 6, tbw, 14.0f);
                g.setColour(stats[i].col.withAlpha(0.15f));
                g.fillRoundedRectangle(tbr, 3.0f);
                g.setColour(stats[i].col);
                g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
                g.drawText(stats[i].type, tbr, juce::Justification::centred);

                // Label
                g.setColour(C::tx3);
                g.setFont(juce::FontOptions(9.0f));
                g.drawText(stats[i].label, scx + 6, cy + 22, cardW2 - 12, 12,
                           juce::Justification::centredLeft);

                // Count
                g.setColour(C::tx);
                g.setFont(juce::FontOptions(13.0f, juce::Font::bold));
                g.drawText(juce::String(stats[i].count), scx + 6, cy + 24, cardW2 - 12, 18,
                           juce::Justification::centredRight);
            }
            cy += 52;
        }

        // ── Node table ──
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
            g.drawText("노드 목록", cx2, cy, 100, 14, juce::Justification::centredLeft);
            cy += 16;

            // Table header
            auto hdr = juce::Rectangle<float>((float)cx2, (float)cy, (float)cw, 18.0f);
            g.setColour(C::bg3);
            g.fillRoundedRectangle(hdr, 4.0f);
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
            int colXs[] = { cx2 + 8, cx2 + cw * 12 / 100, cx2 + cw * 26 / 100, cx2 + cw * 62 / 100 };
            const char* colNames[] = { "NODE", "TYPE", "VENDOR / DEVICE", "IP : PORT" };
            for (int c = 0; c < 4; c++)
                g.drawText(colNames[c], colXs[c], cy + 1, 100, 16, juce::Justification::centredLeft);
            cy += 22;

            // Rows
            auto& nodeMap = engine.getNodes();
            auto now = juce::Time::currentTimeMillis();
            bool anyNode = false;

            for (auto& [nk, node] : nodeMap)
            {
                if (now - node.lastSeen > 30000) continue;
                anyNode = true;

                auto rowR = juce::Rectangle<float>((float)cx2, (float)cy, (float)cw, 26.0f);
                g.setColour(C::bg2);
                g.fillRoundedRectangle(rowR, 4.0f);

                // Node name
                g.setColour(C::tx2);
                g.setFont(juce::FontOptions(10.0f, juce::Font::bold));
                g.drawText(node.name.isEmpty() ? "NODE" : node.name,
                    colXs[0], cy + 4, 80, 18, juce::Justification::centredLeft);

                // Type badge (SRV / CLI)
                bool isSrv = (node.nodeType == 0x02);
                auto tbr = juce::Rectangle<float>((float)colXs[1], (float)cy + 5, 28.0f, 16.0f);
                g.setColour(isSrv ? C::grn.withAlpha(0.15f) : C::blu.withAlpha(0.15f));
                g.fillRoundedRectangle(tbr, 3.0f);
                g.setColour(isSrv ? C::grn : C::blu);
                g.setFont(juce::FontOptions(8.0f, juce::Font::bold));
                g.drawText(isSrv ? "SRV" : "CLI", tbr, juce::Justification::centred);

                // Vendor · Device
                juce::String vd = node.vendor;
                if (node.device.isNotEmpty()) vd += " \xc2\xb7 " + node.device;
                g.setColour(C::tx3);
                g.setFont(juce::FontOptions(10.0f));
                g.drawText(vd, colXs[2], cy + 4, colXs[3] - colXs[2] - 8, 18,
                           juce::Justification::centredLeft);

                // IP:lPort
                juce::String ipStr = node.ip;
                if (node.listenerPort > 0) ipStr += ":" + juce::String(node.listenerPort);
                g.setColour(C::tx4);
                g.setFont(juce::FontOptions(10.0f));
                g.drawText(ipStr, colXs[3], cy + 4, cw - colXs[3] + cx2 - 8, 18,
                           juce::Justification::centredLeft);

                cy += 30;
                if (cy > contentArea.getBottom() - 30) break;
            }

            if (!anyNode)
            {
                g.setColour(C::tx4);
                g.setFont(juce::FontOptions(12.0f));
                g.drawText("TCNet 노드가 감지되지 않았습니다",
                    cx2, cy, cw, 40, juce::Justification::centred);
            }
        }
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

        // Section headers drawn at fixed y positions matching layoutSettings()
        // layoutSettings top = 168+4=172, each section header = 20px
        // Row heights: 26+3 = 29 per row
        auto sa = getLocalBounds().withTrimmedTop(148).withTrimmedBottom(26).reduced(24, 0);
        int sy = sa.getY() + 4;  // start y

        auto drawSection = [&](const char* name, int y)
        {
            g.setColour(C::tx4);
            g.setFont(juce::FontOptions(9.0f, juce::Font::bold));
            float labelW2 = (float)(juce::String(name).length() * 6 + 8);
            g.drawText(name, sa.getX(), y, (int)labelW2 + 2, 14, juce::Justification::centredLeft);
            g.setColour(C::bdr2);
            g.drawHorizontalLine(y + 7, (float)(sa.getX() + (int)labelW2 + 6), (float)sa.getRight());
        };

        // Section header offsets (each row = 29px: rowH=26 + gap=3)
        // Waveform: 2 rows = 58px
        // TCNet: 4 rows = 116px
        // Pro DJ Link: 1 row = 29px
        // 오디오: 1 row = 29px
        // SMPTE: 6 rows = 174px
        drawSection("웨이브폼 설정", sy);
        drawSection("TCNet 설정",     sy + 20 + 58);
        drawSection("Pro DJ Link",    sy + 20 + 58 + 20 + 116);
        drawSection("오디오 출력",    sy + 20 + 58 + 20 + 116 + 20 + 29);
        drawSection("SMPTE 타임코드 출력", sy + 20 + 58 + 20 + 116 + 20 + 29 + 20 + 29);

        // Info at bottom
        int infoY = sy + 20 + 58 + 20 + 116 + 20 + 29 + 20 + 29 + 20 + 174 + 16;
        drawSection("정보", infoY);
        struct InfoRow { juce::String label; juce::String value; juce::Colour col; };
        InfoRow infoRows[] = {
            { "Version",    "v1.0.0",        C::tx2 },
            { "Protocol",   "TCNet v3.5",    C::tx2 },
            { "Data TX",    "BC + 유니캐스트", C::org },
        };
        int iry = infoY + 18;
        for (auto& ir : infoRows)
        {
            g.setColour(C::tx3);
            g.setFont(juce::FontOptions(10.0f));
            g.drawText(ir.label, sa.getX(), iry, 160, 18, juce::Justification::centredLeft);
            g.setColour(ir.col);
            g.drawText(ir.value, sa.getX() + 160, iry, 200, 18, juce::Justification::centredLeft);
            iry += 20;
        }

        // Dual-NIC tip
        auto tipRect = juce::Rectangle<float>((float)sa.getX(), (float)(iry + 4),
                                               (float)sa.getWidth(), 32.0f);
        if (tipRect.getBottom() < (float)(h - 30))
        {
            g.setColour(juce::Colour(0x14ecb210));
            g.fillRoundedRectangle(tipRect, 6.0f);
            g.setColour(C::ylw);
            g.fillEllipse(tipRect.getX() + 8, tipRect.getCentreY() - 3, 6.0f, 6.0f);
            g.setColour(C::ylw);
            g.setFont(juce::FontOptions(9.0f));
            g.drawText("두 NIC: TCNet = 192.168.x.x, Pro DJ Link = 169.254.x.x (CDJ 이더넷)",
                (int)(tipRect.getX() + 22), (int)tipRect.getY(),
                (int)(tipRect.getWidth() - 24), (int)tipRect.getHeight(),
                juce::Justification::centredLeft);
        }
    }

    // ── Bottom bar (26px) ──
    g.setColour(C::bgLo);
    g.fillRect(0, h - 26, w, 26);
    g.setColour(C::bdr);
    g.drawHorizontalLine(h - 26, 0, (float)w);

    // Deck state dots
    float dotX = 14.0f;
    float dotY = (float)(h - 26) + 10.0f;
    for (int i = 0; i < visibleDecks; i++)
    {
        juce::Colour dotCol = C::tx4;
        if (engine.isHWMode(i))
        {
            auto* ls = engine.getLayerState(i);
            if (ls && (ls->state == PlayState::PLAYING || ls->state == PlayState::LOOPING))
                dotCol = C::grn;
            else
                dotCol = C::pur.withAlpha(0.6f);
        }
        else if (engine.isVirtualDeckActive(i))
        {
            auto st = engine.getVirtualDeck(i).getState();
            if (st == PlayState::PLAYING || st == PlayState::LOOPING)
                dotCol = C::grn;
            else if (st == PlayState::CUED || st == PlayState::CUEING)
                dotCol = C::ylw;
            else if (engine.getVirtualDeck(i).isLoaded())
                dotCol = C::tx2;
        }
        g.setColour(dotCol);
        g.fillEllipse(dotX, dotY, 6.0f, 6.0f);
        dotX += 11.0f;
    }
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

    // Status bar drawn in paint() as pills

    // Output layer selectors + mode buttons (LINK tab only)
    {
        int cardW = (w - 28) / 3;
        bool showLink = (activeTab == TAB_LINK);
        for (int i = 0; i < 3; i++)
        {
            int cx = 12 + i * (cardW + 4);
            // Source selector: y=146, inside card at cy=128
            outSrcSelectors[(size_t)i].setBounds(cx + 30, 146, cardW - 38, 18);
            outSrcSelectors[(size_t)i].setVisible(showLink);
            // LTC/MTC/ART buttons: y=167
            int btnW = 28, btnGap = 3;
            for (int m = 0; m < 3; m++)
            {
                outModeBtns[(size_t)i][(size_t)m].setBounds(
                    cx + 8 + m * (btnW + btnGap), 167, btnW, 13);
                outModeBtns[(size_t)i][(size_t)m].setVisible(showLink);
            }
            // OFFSET editor: y=194, h=12 (label "OFFSET ms" painted at y=196)
            outOffsetEditors[(size_t)i].setBounds(cx + 70, 194, cardW - 78, 12);
            outOffsetEditors[(size_t)i].setVisible(showLink);
        }
    }

    // Mode bar / add deck button (LINK tab only)
    modeToggleBtn.setBounds(96, 211, 122, 22);
    addDeckBtn.setBounds(w - 130, 211, 118, 22);

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
    area.removeFromTop(260);  // header(52)+tabs(36)+statusbar(24)+outputlayers(96)+modebar(32)+sectionlabel(20)
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

    const int rowH   = 26;
    const int labelW = 180;
    const int ctrlW  = 200;
    const int gap    = 3;

    auto placeRow = [&](juce::Label& lbl, juce::Component& ctrl)
    {
        auto row = area.removeFromTop(rowH);
        lbl.setBounds(row.removeFromLeft(labelW));
        ctrl.setBounds(row.removeFromLeft(ctrlW));
        area.removeFromTop(gap);
    };

    // ── 웨이브폼 설정 ──
    area.removeFromTop(20);  // section header
    placeRow(wfCenterLabel,  wfCenterSelector);
    placeRow(phasorModeLabel, phasorModeSelector);

    // ── TCNet 설정 ──
    area.removeFromTop(20);
    placeRow(nodeNameLabel,   nodeNameEditor);
    placeRow(tcnetIfaceLabel, tcnetIfaceSelector);
    placeRow(fpsLabel,        fpsSelector);
    placeRow(tcnetModeLabel,  tcnetModeSelector);

    // ── Pro DJ Link 설정 ──
    area.removeFromTop(20);
    placeRow(pdjlIfaceLabel,  pdjlIfaceSelector);

    // ── 오디오 출력 ──
    area.removeFromTop(20);
    placeRow(audioOutLabel,   audioOutSelector);

    // ── SMPTE 타임코드 출력 ──
    area.removeFromTop(20);
    placeRow(tcFpsLabel,       tcFpsSelector);
    placeRow(ltcALabel,        ltcASelector);
    placeRow(ltcBLabel,        ltcBSelector);
    placeRow(ltcMLabel,        ltcMSelector);
    placeRow(artnetIpLabel,    artnetIpEditor);
    placeRow(artnetPortLabel,  artnetPortEditor);
}

void MainComponent::timerCallback()
{
    if (engine.isRunning())
    {
        statusLabel.setText("RUNNING", juce::dontSendNotification);
        statusLabel.setColour(juce::Label::textColourId, C::grn);
        tcnetOnline   = true;
        statusTCNet   = "ONLINE";
        statusArena   = juce::String(engine.getNodeCount());
        statusUptime  = formatUptime(engine.getUptimeSeconds());
        packetLabel.setText("TCNet TX: " + juce::String(engine.getPacketCount()), juce::dontSendNotification);
    }
    else
    {
        statusLabel.setText("READY", juce::dontSendNotification);
        statusLabel.setColour(juce::Label::textColourId, C::tx3);
        tcnetOnline  = false;
        statusTCNet  = "OFFLINE";
        statusUptime = "—";
    }

    int activeCount = 0;
    for (int i = 0; i < 8; i++)
        if (engine.isVirtualDeckActive(i) || engine.isHWMode(i)) activeCount++;
    statusDecks = juce::String(activeCount);

    if (activeTab == TAB_LINK)
        for (int i = 0; i < visibleDecks; i++)
            if (deckPanels[(size_t)i])
            {
                deckPanels[(size_t)i]->setWfCenterLeft(wfCenterLeft);
                deckPanels[(size_t)i]->setPhasorScroll(phasorScroll);
                deckPanels[(size_t)i]->updateDisplay();
            }

    if (activeTab == TAB_PDJL || activeTab == TAB_TCNET)
        repaint();
}
