#include "VirtualDeck.h"

int VirtualDeck::nextTrackId = 1000;

VirtualDeck::VirtualDeck() {}

bool VirtualDeck::loadFile(const juce::File& file)
{
    juce::AudioFormatManager formatManager;
    formatManager.registerBasicFormats();

    auto reader = std::unique_ptr<juce::AudioFormatReader>(
        formatManager.createReaderFor(file));
    if (!reader) return false;

    audioBuffer.setSize((int)reader->numChannels, (int)reader->lengthInSamples);
    reader->read(&audioBuffer, 0, (int)reader->lengthInSamples, 0, true, true);

    fileSampleRate = reader->sampleRate;
    durationMs = (float)(reader->lengthInSamples / reader->sampleRate * 1000.0);

    wfData = analyzeAudio(audioBuffer, reader->sampleRate);
    bpm = detectBpm(audioBuffer, reader->sampleRate);

    // ID3 metadata
    title = file.getFileNameWithoutExtension();
    artist = {};
    if (reader->metadataValues.containsKey("title"))
    {
        auto t = reader->metadataValues.getValue("title", "");
        if (t.isNotEmpty()) title = t;
    }
    if (reader->metadataValues.containsKey("artist"))
        artist = reader->metadataValues.getValue("artist", "");
    if (reader->metadataValues.containsKey("bpm"))
    {
        float tagBpm = reader->metadataValues.getValue("bpm", "0").getFloatValue();
        if (tagBpm >= 60.0f && tagBpm <= 200.0f) bpm = tagBpm;
    }

    trackId = nextTrackId++;
    cuePointMs = 0.0f;
    playSamplePos.store(0);
    positionMs.store(0.0f);
    state.store(PlayState::CUED);

    DBG("VirtualDeck: loaded " + file.getFileName()
        + " dur=" + juce::String(durationMs / 1000.0f, 1) + "s"
        + " bpm=" + juce::String(bpm, 1));

    return true;
}

void VirtualDeck::eject()
{
    state.store(PlayState::IDLE);
    playSamplePos.store(0);
    positionMs.store(0.0f);
    audioBuffer.setSize(0, 0);
    title = {}; artist = {};
    durationMs = 0.0f; bpm = 0.0f;
    cuePointMs = 0.0f; wfData.clear();
}

// ── CDJ-3000 Transport ──────────────────────

void VirtualDeck::playPause()
{
    if (!isLoaded()) return;
    PlayState cur = state.load();
    DBG("playPause: " + playStateToString(cur));
    if (cur == PlayState::PLAYING || cur == PlayState::LOOPING)
        state.store(PlayState::PAUSED);
    else
        state.store(PlayState::PLAYING);
}

void VirtualDeck::cueDown()
{
    if (!isLoaded()) return;
    PlayState cur = state.load();
    DBG("cueDown: " + playStateToString(cur));

    if (cur == PlayState::PLAYING || cur == PlayState::LOOPING)
    {
        // Playing → pause at current position (cue point unchanged)
        state.store(PlayState::CUED);
    }
    else
    {
        // Stopped/Cued/Paused → set cue at current pos, preview play
        cuePointMs = positionMs.load();
        seekTo(cuePointMs);
        state.store(PlayState::CUEING);  // CUEING = preview play from cue
    }
}

void VirtualDeck::cueUp()
{
    if (!isLoaded()) return;
    DBG("cueUp: returning to cue " + juce::String(cuePointMs));
    // Return to cue point and stop
    seekTo(cuePointMs);
    state.store(PlayState::CUED);
}

void VirtualDeck::play()
{
    if (!isLoaded()) return;
    state.store(PlayState::PLAYING);
}

void VirtualDeck::pause()
{
    PlayState cur = state.load();
    if (cur == PlayState::PLAYING || cur == PlayState::LOOPING || cur == PlayState::CUEING)
        state.store(PlayState::PAUSED);
}

void VirtualDeck::stop()
{
    state.store(PlayState::STOPPED);
    int cueSample = (int)(cuePointMs / 1000.0f * fileSampleRate);
    playSamplePos.store(cueSample);
    positionMs.store(cuePointMs);
}

void VirtualDeck::seekTo(float ms)
{
    int sample = (int)(ms / 1000.0f * fileSampleRate);
    sample = juce::jlimit(0, audioBuffer.getNumSamples() - 1, sample);
    playSamplePos.store(sample);
    positionMs.store(ms);
}

// ── Audio Thread ─────────────────────────────

void VirtualDeck::getNextAudioBlock(float* left, float* right, int numSamples)
{
    PlayState currentState = state.load();

    // Only output audio when PLAYING, LOOPING, or CUEING (cue preview)
    if (currentState != PlayState::PLAYING &&
        currentState != PlayState::LOOPING &&
        currentState != PlayState::CUEING)
    {
        std::memset(left, 0, (size_t)numSamples * sizeof(float));
        std::memset(right, 0, (size_t)numSamples * sizeof(float));
        return;
    }

    int totalSamples = audioBuffer.getNumSamples();
    if (totalSamples == 0) return;

    int pos = playSamplePos.load();
    int numChannels = audioBuffer.getNumChannels();
    const float* srcL = audioBuffer.getReadPointer(0);
    const float* srcR = numChannels > 1 ? audioBuffer.getReadPointer(1) : srcL;

    double speedRatio = (fileSampleRate / deviceSampleRate) * (1.0 + pitch / 100.0);

    for (int i = 0; i < numSamples; i++)
    {
        int idx = (int)((double)pos + (double)i * speedRatio);
        if (idx >= totalSamples)
        {
            state.store(PlayState::STOPPED);
            for (int j = i; j < numSamples; j++)
                left[j] = right[j] = 0.0f;
            playSamplePos.store(0);
            positionMs.store(0.0f);
            return;
        }
        left[i] = srcL[idx] * volume;
        right[i] = srcR[idx] * volume;
    }

    int advance = (int)((double)numSamples * speedRatio);
    pos += advance;
    if (pos >= totalSamples)
    {
        pos = 0;
        state.store(PlayState::STOPPED);
    }
    playSamplePos.store(pos);
    positionMs.store((float)pos / (float)fileSampleRate * 1000.0f);
}

uint8_t VirtualDeck::getBeatPhase() const
{
    if (bpm <= 0) return 0;
    float msPerBeat = 60000.0f / bpm;
    float phase = std::fmod(positionMs.load(), msPerBeat * 4.0f) / (msPerBeat * 4.0f);
    return (uint8_t)((int)(phase * 4.0f) * 64);
}

void VirtualDeck::fillLayerState(LayerState& ls) const
{
    PlayState st = state.load();
    ls.state        = (st == PlayState::CUEING) ? PlayState::CUED : st;
    ls.timecodeMs   = positionMs.load();
    ls.totalLengthMs = durationMs;
    ls.bpm          = bpm * (1.0f + pitch / 100.0f);
    ls.pitch        = pitch;
    ls.trackId      = trackId;
    ls.beatPhase    = getBeatPhase();
    ls.trackName    = title;
    ls.artistName   = artist;
    ls.deviceName   = deviceName;
    ls.updateTime   = juce::Time::currentTimeMillis();
}

// ── Analysis ─────────────────────────────────

float VirtualDeck::detectBpm(const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    const float* ch = buffer.getReadPointer(0);
    const int N = buffer.getNumSamples();
    const int windowSamples = (int)(sampleRate * 0.01);
    const int numWindows = N / windowSamples;
    if (numWindows < 100) return 120.0f;

    std::vector<float> energy((size_t)numWindows);
    for (int w = 0; w < numWindows; w++)
    {
        float sum = 0;
        int start = w * windowSamples;
        for (int i = 0; i < windowSamples && (start + i) < N; i++)
        {
            float s = ch[start + i];
            sum += s * s;
        }
        energy[(size_t)w] = sum / (float)windowSamples;
    }

    std::vector<float> onset((size_t)numWindows);
    for (int i = 1; i < numWindows; i++)
        onset[(size_t)i] = juce::jmax(0.0f, energy[(size_t)i] - energy[(size_t)i - 1]);

    float bestCorr = 0, bestBpm = 120.0f;
    int minLag = (int)(60.0 / 180.0 / 0.01);
    int maxLag = (int)(60.0 / 70.0 / 0.01);

    for (int lag = minLag; lag <= maxLag && lag < numWindows / 2; lag++)
    {
        float corr = 0;
        int count = juce::jmin(numWindows - lag, 500);
        for (int i = 0; i < count; i++)
            corr += onset[(size_t)i] * onset[(size_t)(i + lag)];
        if (corr > bestCorr) { bestCorr = corr; bestBpm = (float)(60.0 / (lag * 0.01)); }
    }

    return std::round(bestBpm * 100.0f) / 100.0f;
}

std::vector<DetailedWaveformPoint> VirtualDeck::analyzeAudio(
    const juce::AudioBuffer<float>& buffer, double sampleRate)
{
    const float* ch = buffer.getReadPointer(0);
    const int numSamples = buffer.getNumSamples();
    int pts = juce::jlimit(6000, 50000, (int)(numSamples / sampleRate * 150.0));
    int step = juce::jmax(1, numSamples / pts);

    auto mkBQ = [](float fc, float sr, float Q) -> std::array<float, 7>
    {
        float w = juce::MathConstants<float>::twoPi * fc / sr;
        float sn = std::sin(w), cs = std::cos(w);
        float al = sn / (2.0f * Q), a0 = 1.0f + al;
        return { ((1.0f - cs) / 2.0f) / a0, (1.0f - cs) / a0,
                 ((1.0f - cs) / 2.0f) / a0, (-2.0f * cs) / a0,
                 (1.0f - al) / a0, 0.0f, 0.0f };
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

    std::vector<DetailedWaveformPoint> wf((size_t)pts);
    for (int i = 0; i < pts; i++)
    {
        int s0 = i * step;
        float pl = 0, pm = 0, ph = 0, pk = 0, sumSq = 0;
        for (int j = 0; j < step && (s0 + j) < numSamples; j++)
        {
            float s = ch[s0 + j]; sumSq += s * s;
            float bassLP = bq(lpB2, bq(lpB1, s));
            float midLP  = bq(lpM2, bq(lpM1, s));
            float ab = std::abs(bassLP), am = std::abs(midLP - bassLP), at = std::abs(s - midLP);
            if (ab > pl) pl = ab; if (am > pm) pm = am;
            if (at > ph) ph = at; float a = std::abs(s); if (a > pk) pk = a;
        }
        wf[(size_t)i] = { pk, pl, pm, ph, std::sqrt(sumSq / (float)step) };
    }
    return wf;
}
