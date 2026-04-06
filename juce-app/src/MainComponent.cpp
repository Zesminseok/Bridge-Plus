#include "MainComponent.h"

MainComponent::MainComponent()
{
    setSize(1040, 840);

    // Waveform display
    addAndMakeVisible(waveform);

    // Start button
    addAndMakeVisible(startBtn);
    startBtn.onClick = [this]
    {
        if (network.isRunning())
        {
            network.stop();
            startBtn.setButtonText("START");
            statusLabel.setText("Stopped", juce::dontSendNotification);
        }
        else
        {
            if (network.start())
            {
                startBtn.setButtonText("STOP");
                statusLabel.setText("Listening on UDP 50001/50002...", juce::dontSendNotification);
            }
            else
            {
                statusLabel.setText("Failed to bind UDP ports", juce::dontSendNotification);
            }
        }
    };

    // Load button (test audio file)
    addAndMakeVisible(loadBtn);
    loadBtn.onClick = [this] { loadTestAudio(); };

    // Status label
    addAndMakeVisible(statusLabel);
    statusLabel.setColour(juce::Label::textColourId, juce::Colours::grey);
    statusLabel.setText("Bridge+ v0.8.0 — JUCE/C++ Edition", juce::dontSendNotification);

    // Start timer for playback simulation
    startTimerHz(60);
}

MainComponent::~MainComponent()
{
    stopTimer();
    network.stop();
}

void MainComponent::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff111318));
}

void MainComponent::resized()
{
    auto area = getLocalBounds().reduced(10);

    auto top = area.removeFromTop(40);
    startBtn.setBounds(top.removeFromLeft(100));
    top.removeFromLeft(10);
    loadBtn.setBounds(top.removeFromLeft(120));
    top.removeFromLeft(10);
    statusLabel.setBounds(top);

    area.removeFromTop(10);
    waveform.setBounds(area);
}

void MainComponent::timerCallback()
{
    // Simulate playback for testing
    if (playing && testDuration > 0.0f)
    {
        testPosition += (1000.0f / 60.0f) / testDuration; // ~60fps advance
        if (testPosition > 1.0f)
            testPosition = 0.0f;

        waveform.setPosition(testPosition);
    }
}

void MainComponent::loadTestAudio()
{
    auto chooser = std::make_shared<juce::FileChooser>(
        "Select Audio File",
        juce::File::getSpecialLocation(juce::File::userMusicDirectory),
        "*.wav;*.mp3;*.aiff;*.flac;*.m4a");

    chooser->launchAsync(juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
        [this, fc = chooser](const juce::FileChooser& c)
        {
            auto file = c.getResult();
            if (!file.existsAsFile())
                return;

            // Decode audio
            juce::AudioFormatManager formatManager;
            formatManager.registerBasicFormats();

            auto reader = std::unique_ptr<juce::AudioFormatReader>(
                formatManager.createReaderFor(file));

            if (!reader)
            {
                statusLabel.setText("Cannot read: " + file.getFileName(), juce::dontSendNotification);
                return;
            }

            // Read all samples
            juce::AudioBuffer<float> buffer((int)reader->numChannels,
                                            (int)reader->lengthInSamples);
            reader->read(&buffer, 0, (int)reader->lengthInSamples, 0, true, true);

            testDuration = (float)(reader->lengthInSamples / reader->sampleRate * 1000.0);

            statusLabel.setText("Analyzing: " + file.getFileName() + " (" +
                juce::String(testDuration / 1000.0f, 1) + "s)", juce::dontSendNotification);

            // Analyze waveform (3-band IIR + peak/RMS)
            auto wfData = analyzeAudio(buffer, reader->sampleRate);

            statusLabel.setText("Loaded: " + file.getFileName() + " — " +
                juce::String(wfData.size()) + " points", juce::dontSendNotification);

            // Set data and start playback
            waveform.setDuration(testDuration);
            waveform.setWaveformData(std::move(wfData));
            waveform.setPosition(0.0f);
            testPosition = 0.0f;
            playing = true;
        });
}

std::vector<WaveformPoint> MainComponent::analyzeAudio(
    const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    const float* ch = buffer.getReadPointer(0);
    const int numSamples = buffer.getNumSamples();

    // ~150 entries/sec (CDJ standard)
    int pts = juce::jlimit(6000, 50000,
        (int)(numSamples / sampleRate * 150.0));
    int step = juce::jmax(1, numSamples / pts);

    // 4th-order Butterworth biquad filters (600Hz / 4000Hz crossover)
    auto mkBQ = [](float fc, float sr, float Q) -> std::array<float, 7>
    {
        float w = juce::MathConstants<float>::twoPi * fc / sr;
        float sn = std::sin(w), cs = std::cos(w);
        float al = sn / (2.0f * Q), a0 = 1.0f + al;
        return { ((1.0f - cs) / 2.0f) / a0,
                 (1.0f - cs) / a0,
                 ((1.0f - cs) / 2.0f) / a0,
                 (-2.0f * cs) / a0,
                 (1.0f - al) / a0,
                 0.0f, 0.0f }; // w1, w2
    };

    auto bq = [](std::array<float, 7>& f, float x) -> float
    {
        float y = f[0] * x + f[5];
        f[5] = f[1] * x - f[3] * y + f[6];
        f[6] = f[2] * x - f[4] * y;
        return y;
    };

    const float Q1 = 0.5412f, Q2 = 1.3066f;
    auto lpB1 = mkBQ(600.0f, (float)sampleRate, Q1);
    auto lpB2 = mkBQ(600.0f, (float)sampleRate, Q2);
    auto lpM1 = mkBQ(4000.0f, (float)sampleRate, Q1);
    auto lpM2 = mkBQ(4000.0f, (float)sampleRate, Q2);

    std::vector<WaveformPoint> wf(pts);

    for (int i = 0; i < pts; i++)
    {
        int s0 = i * step;
        float pl = 0, pm = 0, ph = 0, pk = 0, sumSq = 0;

        for (int j = 0; j < step && (s0 + j) < numSamples; j++)
        {
            float s = ch[s0 + j];
            sumSq += s * s;

            float bassLP = bq(lpB2, bq(lpB1, s));
            float midLP = bq(lpM2, bq(lpM1, s));
            float bass = bassLP;
            float mid2 = midLP - bassLP;
            float tre = s - midLP;

            float ab = std::abs(bass), am = std::abs(mid2), at = std::abs(tre);
            if (ab > pl) pl = ab;
            if (am > pm) pm = am;
            if (at > ph) ph = at;

            float a = std::abs(s);
            if (a > pk) pk = a;
        }

        wf[i].peak = pk;
        wf[i].bass = pl;
        wf[i].mid = pm;
        wf[i].treble = ph;
        wf[i].rms = std::sqrt(sumSq / (float)step);
    }

    return wf;
}
