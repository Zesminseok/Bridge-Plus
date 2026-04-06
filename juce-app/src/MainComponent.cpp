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
    setupLabel(bpmLabel,    20.0f, juce::Colours::cyan);
    setupLabel(timeLabel,   18.0f, juce::Colour(0xff00ff88));
    setupLabel(stateLabel,  14.0f, juce::Colours::yellow);

    titleLabel.setText("Deck " + juce::String(deckNum + 1), juce::dontSendNotification);
    bpmLabel.setText("--- BPM", juce::dontSendNotification);
    timeLabel.setText("00:00.000", juce::dontSendNotification);
    stateLabel.setText("IDLE", juce::dontSendNotification);

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
    g.setColour(juce::Colour(0xff1a1d24));
    g.fillRoundedRectangle(bounds, 6.0f);

    g.setColour(juce::Colour(0xff2a2d34));
    g.drawRoundedRectangle(bounds.reduced(0.5f), 6.0f, 1.0f);

    // Deck number indicator
    g.setColour(juce::Colour(0xff00aaff));
    g.setFont(juce::FontOptions(24.0f, juce::Font::bold));
    g.drawText(juce::String(deckNum + 1), 8, 6, 30, 30, juce::Justification::centred);
}

void DeckPanel::resized()
{
    auto area = getLocalBounds().reduced(8);
    auto top = area.removeFromTop(28);
    top.removeFromLeft(32);  // deck number space
    titleLabel.setBounds(top);

    auto info = area.removeFromTop(22);
    info.removeFromLeft(32);
    artistLabel.setBounds(info);

    area.removeFromTop(6);
    auto row = area.removeFromTop(28);
    bpmLabel.setBounds(row.removeFromLeft(120));
    timeLabel.setBounds(row.removeFromLeft(140));
    stateLabel.setBounds(row);

    area.removeFromTop(6);
    auto btns = area.removeFromTop(30);
    int bw = (btns.getWidth() - 16) / 5;
    loadBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    playBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    pauseBtn.setBounds(btns.removeFromLeft(bw));  btns.removeFromLeft(4);
    stopBtn.setBounds(btns.removeFromLeft(bw));   btns.removeFromLeft(4);
    cueBtn.setBounds(btns);
}

void DeckPanel::updateDisplay()
{
    auto& deck = engine.getVirtualDeck(deckNum);

    if (deck.getDurationMs() > 0)
    {
        titleLabel.setText(deck.getTitle(), juce::dontSendNotification);
        artistLabel.setText(deck.getArtist().isEmpty() ? deck.getDeviceName() : deck.getArtist(),
                           juce::dontSendNotification);
        bpmLabel.setText(juce::String(deck.getBpm(), 1) + " BPM", juce::dontSendNotification);
        timeLabel.setText(formatTime(deck.getPositionMs()) + " / " + formatTime(deck.getDurationMs()),
                         juce::dontSendNotification);
        stateLabel.setText(playStateToString(deck.getState()), juce::dontSendNotification);

        // State-based color
        auto stateCol = juce::Colours::grey;
        switch (deck.getState())
        {
            case PlayState::PLAYING: case PlayState::LOOPING:
                stateCol = juce::Colours::lime; break;
            case PlayState::PAUSED: case PlayState::CUED:
                stateCol = juce::Colours::orange; break;
            case PlayState::STOPPED:
                stateCol = juce::Colours::red; break;
            default: break;
        }
        stateLabel.setColour(juce::Label::textColourId, stateCol);
    }
    else
    {
        titleLabel.setText("Deck " + juce::String(deckNum + 1) + " — Empty",
                          juce::dontSendNotification);
        artistLabel.setText("", juce::dontSendNotification);
        bpmLabel.setText("--- BPM", juce::dontSendNotification);
        timeLabel.setText("00:00.000", juce::dontSendNotification);
        stateLabel.setText("IDLE", juce::dontSendNotification);
    }
}

// ── MainComponent ────────────────────────────
MainComponent::MainComponent()
{
    setSize(1040, 700);

    // Version label
    addAndMakeVisible(versionLabel);
    versionLabel.setText("Bridge+ v0.9.0 — JUCE/C++", juce::dontSendNotification);
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
    startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff224488));
    startBtn.setColour(juce::TextButton::textColourOffId, juce::Colours::white);
    startBtn.onClick = [this]
    {
        if (engine.isRunning())
        {
            engine.stop();
            startBtn.setButtonText("START BRIDGE");
            startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff224488));
            statusLabel.setText("Stopped", juce::dontSendNotification);
        }
        else
        {
            if (engine.start())
            {
                startBtn.setButtonText("STOP BRIDGE");
                startBtn.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff882222));
                statusLabel.setText("TCNet broadcasting...", juce::dontSendNotification);
            }
            else
            {
                statusLabel.setText("Failed to start", juce::dontSendNotification);
            }
        }
    };

    // Deck panels
    for (int i = 0; i < 4; i++)
    {
        deckPanels[(size_t)i] = std::make_unique<DeckPanel>(i, engine);
        addAndMakeVisible(deckPanels[(size_t)i].get());
    }

    startTimerHz(15);  // UI refresh 15fps
}

MainComponent::~MainComponent()
{
    stopTimer();
    engine.stop();
}

void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff111318));

    // Title bar area
    g.setColour(juce::Colour(0xff181b22));
    g.fillRect(0, 0, getWidth(), 50);

    g.setColour(juce::Colour(0xff2a2d34));
    g.drawLine(0, 50, (float)getWidth(), 50, 1.0f);
}

void MainComponent::resized()
{
    auto area = getLocalBounds();

    // Top bar
    auto top = area.removeFromTop(50).reduced(10, 8);
    startBtn.setBounds(top.removeFromLeft(160));
    top.removeFromLeft(12);
    statusLabel.setBounds(top.removeFromLeft(top.getWidth() - 200));
    versionLabel.setBounds(top);

    area.removeFromTop(8);

    // Deck panels in 2×2 grid
    auto deckArea = area.reduced(10, 0);
    int halfW = (deckArea.getWidth() - 10) / 2;
    int halfH = (deckArea.getHeight() - 10) / 2;

    deckPanels[0]->setBounds(deckArea.getX(), deckArea.getY(), halfW, halfH);
    deckPanels[1]->setBounds(deckArea.getX() + halfW + 10, deckArea.getY(), halfW, halfH);
    deckPanels[2]->setBounds(deckArea.getX(), deckArea.getY() + halfH + 10, halfW, halfH);
    deckPanels[3]->setBounds(deckArea.getX() + halfW + 10, deckArea.getY() + halfH + 10, halfW, halfH);
}

void MainComponent::timerCallback()
{
    // Update status
    if (engine.isRunning())
        statusLabel.setText(engine.getStatusText(), juce::dontSendNotification);

    // Update deck panels
    for (auto& panel : deckPanels)
        panel->updateDisplay();
}
