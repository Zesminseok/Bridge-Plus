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

// ── DeckPanel ────────────────────────────────
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

    setupLabel(titleLabel,  16.0f, juce::Colours::white);
    setupLabel(artistLabel, 13.0f, juce::Colour(0xffaaaaaa));
    setupLabel(bpmLabel,    22.0f, juce::Colours::cyan);
    setupLabel(timeLabel,   18.0f, juce::Colour(0xff00ff88));
    setupLabel(stateLabel,  13.0f, juce::Colours::yellow);

    titleLabel.setText("Deck " + juce::String(deckNum + 1), juce::dontSendNotification);

    auto setupBtn = [this](juce::TextButton& btn, juce::Colour col)
    {
        addAndMakeVisible(btn);
        btn.setColour(juce::TextButton::buttonColourId, col);
        btn.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
    };

    setupBtn(loadBtn,  juce::Colour(0xff333344));
    setupBtn(playBtn,  juce::Colour(0xff226622));
    setupBtn(pauseBtn, juce::Colour(0xff664422));
    setupBtn(stopBtn,  juce::Colour(0xff662222));
    setupBtn(cueBtn,   juce::Colour(0xff224466));

    // Volume slider
    addAndMakeVisible(volumeSlider);
    volumeSlider.setRange(0.0, 1.0, 0.01);
    volumeSlider.setValue(1.0);
    volumeSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    volumeSlider.setTextBoxStyle(juce::Slider::NoTextBox, true, 0, 0);
    volumeSlider.setColour(juce::Slider::trackColourId, juce::Colour(0xff446688));
    volumeSlider.setColour(juce::Slider::thumbColourId, juce::Colour(0xff88aacc));
    volumeSlider.onValueChange = [this]
    {
        engine.getVirtualDeck(deckNum).setVolume((float)volumeSlider.getValue());
    };

    loadBtn.onClick = [this]
    {
        auto chooser = std::make_shared<juce::FileChooser>(
            "Select Audio", juce::File::getSpecialLocation(juce::File::userMusicDirectory),
            "*.wav;*.mp3;*.aiff;*.flac;*.m4a");

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

    playBtn.onClick  = [this] { engine.getVirtualDeck(deckNum).play(); };
    pauseBtn.onClick = [this] { engine.getVirtualDeck(deckNum).pause(); };
    stopBtn.onClick  = [this] { engine.getVirtualDeck(deckNum).stop(); };
    cueBtn.onClick   = [this] { engine.getVirtualDeck(deckNum).cue(); };
}

void DeckPanel::paint(juce::Graphics& g)
{
    auto bounds = getLocalBounds().toFloat();

    // Background
    g.setColour(juce::Colour(0xff1a1d24));
    g.fillRoundedRectangle(bounds, 6.0f);

    // Border — color based on state
    auto& deck = engine.getVirtualDeck(deckNum);
    juce::Colour borderCol(0xff2a2d34);
    if (deck.isLoaded())
    {
        switch (deck.getState())
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                borderCol = juce::Colour(0xff22aa44); break;
            case PlayState::PAUSED:
                borderCol = juce::Colour(0xffaa8822); break;
            case PlayState::CUED:
                borderCol = juce::Colour(0xff2266aa); break;
            default: break;
        }
    }
    g.setColour(borderCol);
    g.drawRoundedRectangle(bounds.reduced(0.5f), 6.0f, 1.5f);

    // Deck number badge
    g.setColour(juce::Colour(0xff00aaff));
    g.setFont(juce::FontOptions(22.0f, juce::Font::bold));
    g.drawText(juce::String(deckNum + 1), 8, 8, 26, 26, juce::Justification::centred);
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(10);

    // Title row
    auto top = area.removeFromTop(24);
    top.removeFromLeft(30);
    titleLabel.setBounds(top);

    // Artist row
    auto art = area.removeFromTop(20);
    art.removeFromLeft(30);
    artistLabel.setBounds(art);

    area.removeFromTop(8);

    // BPM + Time + State row
    auto infoRow = area.removeFromTop(28);
    bpmLabel.setBounds(infoRow.removeFromLeft(130));
    timeLabel.setBounds(infoRow.removeFromLeft(160));
    stateLabel.setBounds(infoRow);

    area.removeFromTop(8);

    // Buttons row
    auto btns = area.removeFromTop(32);
    int bw = (btns.getWidth() - 16) / 5;
    loadBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    playBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    pauseBtn.setBounds(btns.removeFromLeft(bw));  btns.removeFromLeft(4);
    stopBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    cueBtn.setBounds(btns);

    area.removeFromTop(6);

    // Volume slider
    auto volRow = area.removeFromTop(20);
    volumeSlider.setBounds(volRow);
}

void DeckPanel::updateDisplay()
{
    auto& deck = engine.getVirtualDeck(deckNum);

    if (deck.isLoaded())
    {
        titleLabel.setText(deck.getTitle(), juce::dontSendNotification);
        artistLabel.setText(deck.getArtist().isEmpty() ? deck.getDeviceName() : deck.getArtist(),
                           juce::dontSendNotification);
        bpmLabel.setText(juce::String(deck.getBpm(), 1) + " BPM", juce::dontSendNotification);
        timeLabel.setText(formatTime(deck.getPositionMs()) + " / " + formatTime(deck.getDurationMs()),
                         juce::dontSendNotification);

        auto st = deck.getState();
        stateLabel.setText(playStateToString(st), juce::dontSendNotification);

        juce::Colour stateCol = juce::Colours::grey;
        switch (st)
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                stateCol = juce::Colours::lime; break;
            case PlayState::PAUSED:
                stateCol = juce::Colours::orange; break;
            case PlayState::CUED:
                stateCol = juce::Colour(0xff44aaff); break;
            case PlayState::STOPPED:
                stateCol = juce::Colours::red; break;
            default: break;
        }
        stateLabel.setColour(juce::Label::textColourId, stateCol);

        // Highlight active button
        playBtn.setColour(juce::TextButton::buttonColourId,
            (st == PlayState::PLAYING || st == PlayState::LOOPING) ? juce::Colour(0xff33cc44) : juce::Colour(0xff226622));
        pauseBtn.setColour(juce::TextButton::buttonColourId,
            st == PlayState::PAUSED ? juce::Colour(0xffcc8833) : juce::Colour(0xff664422));
        cueBtn.setColour(juce::TextButton::buttonColourId,
            st == PlayState::CUED ? juce::Colour(0xff3388cc) : juce::Colour(0xff224466));
    }

    repaint();  // Update border color
}

// ── MainComponent ────────────────────────────
MainComponent::MainComponent()
{
    // Version label
    addAndMakeVisible(versionLabel);
    versionLabel.setText("Bridge+ v0.9.1 | JUCE/C++", juce::dontSendNotification);
    versionLabel.setColour(juce::Label::textColourId, juce::Colour(0xff666688));
    versionLabel.setFont(juce::FontOptions(13.0f));
    versionLabel.setJustificationType(juce::Justification::centredRight);

    // Status label
    addAndMakeVisible(statusLabel);
    statusLabel.setColour(juce::Label::textColourId, juce::Colour(0xff88aacc));
    statusLabel.setFont(juce::FontOptions(14.0f));
    statusLabel.setText("Ready", juce::dontSendNotification);

    // Start button
    addAndMakeVisible(startBtn);
    startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff3366cc));
    startBtn.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
    startBtn.onClick = [this]
    {
        if (engine.isRunning())
        {
            engine.stop();
            startBtn.setButtonText("START BRIDGE");
            startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff3366cc));
            statusLabel.setText("Stopped", juce::dontSendNotification);
        }
        else
        {
            if (engine.start())
            {
                startBtn.setButtonText("STOP BRIDGE");
                startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xffcc3333));
                statusLabel.setText("TCNet broadcasting...", juce::dontSendNotification);
            }
        }
    };

    // + DECK button
    addAndMakeVisible(addDeckBtn);
    addDeckBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff2a4420));
    addDeckBtn.setColour(juce::TextButton::textColourOffId, juce::Colour(0xff88cc88));
    addDeckBtn.onClick = [this]
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
        if (visibleDecks < 8)
            addDeckBtn.setButtonText("+ DECK (" + juce::String(visibleDecks) + "/8)");
        else
            addDeckBtn.setEnabled(false);
    };

    // Audio output — stereo, no input
    setAudioChannels(0, 2);

    setSize(1040, 700);
    startTimerHz(20);  // UI refresh 20fps
}

MainComponent::~MainComponent()
{
    stopTimer();
    shutdownAudio();
    engine.stop();
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

    // Temp buffers for each deck
    std::vector<float> tmpL((size_t)numSamples, 0.0f);
    std::vector<float> tmpR((size_t)numSamples, 0.0f);

    for (int d = 0; d < 8; d++)
    {
        if (!engine.isVirtualDeckActive(d)) continue;

        auto& deck = engine.getVirtualDeck(d);
        if (!deck.isLoaded()) continue;

        deck.getNextAudioBlock(tmpL.data(), tmpR.data(), numSamples);

        // Mix into output
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
    g.fillAll(juce::Colour(0xff111318));

    // Top bar
    g.setColour(juce::Colour(0xff181b22));
    g.fillRect(0, 0, getWidth(), 50);
    g.setColour(juce::Colour(0xff2a2d34));
    g.drawLine(0, 50, (float)getWidth(), 50, 1.0f);

    // Empty state
    if (visibleDecks == 0)
    {
        g.setColour(juce::Colour(0xff555566));
        g.setFont(juce::FontOptions(18.0f));
        g.drawText("Click \"+ DECK\" to add a virtual deck",
                   getLocalBounds().withTrimmedTop(50),
                   juce::Justification::centred);
    }
}

void MainComponent::resized()
{
    auto area = getLocalBounds();

    auto top = area.removeFromTop(50).reduced(10, 8);
    startBtn.setBounds(top.removeFromLeft(150));
    top.removeFromLeft(8);
    addDeckBtn.setBounds(top.removeFromLeft(120));
    top.removeFromLeft(12);
    statusLabel.setBounds(top.removeFromLeft(top.getWidth() - 200));
    versionLabel.setBounds(top);

    layoutDecks();
}

void MainComponent::layoutDecks()
{
    if (visibleDecks == 0) return;

    auto area = getLocalBounds().withTrimmedTop(58).reduced(10, 4);

    if (visibleDecks == 1)
    {
        deckPanels[0]->setBounds(area);
    }
    else if (visibleDecks == 2)
    {
        int halfW = (area.getWidth() - 10) / 2;
        deckPanels[0]->setBounds(area.getX(), area.getY(), halfW, area.getHeight());
        deckPanels[1]->setBounds(area.getX() + halfW + 10, area.getY(), halfW, area.getHeight());
    }
    else
    {
        int cols = 2;
        int rows = (visibleDecks + 1) / 2;
        int cellW = (area.getWidth() - 10) / cols;
        int cellH = (area.getHeight() - (rows - 1) * 10) / rows;

        for (int i = 0; i < visibleDecks; i++)
        {
            int col = i % 2;
            int row = i / 2;
            if (deckPanels[(size_t)i])
                deckPanels[(size_t)i]->setBounds(
                    area.getX() + col * (cellW + 10),
                    area.getY() + row * (cellH + 10),
                    cellW, cellH);
        }
    }
}

void MainComponent::timerCallback()
{
    if (engine.isRunning())
        statusLabel.setText(engine.getStatusText(), juce::dontSendNotification);

    for (int i = 0; i < visibleDecks; i++)
        if (deckPanels[(size_t)i])
            deckPanels[(size_t)i]->updateDisplay();
}
