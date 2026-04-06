#pragma once
#include <JuceHeader.h>
#include "DeckState.h"
#include <vector>
#include <mutex>

/**
 * VirtualDeck — simulated CDJ for testing without hardware.
 * Loads audio files, analyzes waveform, simulates playback.
 */
class VirtualDeck
{
public:
    VirtualDeck();

    // Load and analyze an audio file
    bool loadFile(const juce::File& file);

    // Playback controls
    void play();
    void pause();
    void stop();
    void cue();
    void setPosition(float ms);

    // Called by engine timer (~60Hz) to advance playback
    void tick(float deltaMs);

    // State
    PlayState getState() const         { return state; }
    float     getPositionMs() const    { return positionMs; }
    float     getDurationMs() const    { return durationMs; }
    float     getBpm() const           { return bpm; }
    float     getPitch() const         { return pitch; }
    int       getTrackId() const       { return trackId; }
    uint8_t   getBeatPhase() const;

    juce::String getTitle() const      { return title; }
    juce::String getArtist() const     { return artist; }
    juce::String getDeviceName() const { return deviceName; }

    void setPitch(float p)             { pitch = p; }
    void setBpm(float b)               { bpm = b; }
    void setDeviceName(const juce::String& n) { deviceName = n; }

    // Fill layer state for TCNet
    void fillLayerState(LayerState& ls) const;

    // Waveform data access
    const std::vector<DetailedWaveformPoint>& getWaveformData() const { return wfData; }
    bool hasWaveform() const { return !wfData.empty(); }

private:
    // Audio analysis
    std::vector<DetailedWaveformPoint> analyzeAudio(
        const juce::AudioBuffer<float>& buffer, double sampleRate);
    float detectBpm(const juce::AudioBuffer<float>& buffer, double sampleRate);

    PlayState state = PlayState::IDLE;
    float positionMs = 0.0f;
    float durationMs = 0.0f;
    float bpm = 0.0f;
    float pitch = 0.0f;
    float cuePointMs = 0.0f;
    int   trackId = 0;

    juce::String title;
    juce::String artist;
    juce::String deviceName = "CDJ-3000";

    std::vector<DetailedWaveformPoint> wfData;

    static int nextTrackId;
};
