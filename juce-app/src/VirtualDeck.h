#pragma once
#include <JuceHeader.h>
#include "DeckState.h"
#include <vector>
#include <atomic>

/**
 * VirtualDeck - simulated CDJ with audio playback.
 * CDJ-3000 style CUE: pointerdown = cue preview, pointerup = return to cue.
 */
class VirtualDeck
{
public:
    VirtualDeck();

    bool loadFile(const juce::File& file);
    bool isLoaded() const { return audioBuffer.getNumSamples() > 0; }
    void eject();

    // Transport - CDJ-3000 style
    void playPause();       // Toggle play/pause (click)
    void cueDown();         // CUE press: playing->pause, stopped->preview
    void cueUp();           // CUE release: return to cue point
    void play();
    void pause();
    void stop();
    void seekTo(float ms);

    // Audio output (audio thread)
    void getNextAudioBlock(float* left, float* right, int numSamples);
    void setSampleRate(double sr) { deviceSampleRate = sr; }

    // State
    PlayState getState() const     { return state.load(); }
    float getPositionMs() const    { return positionMs.load(); }
    float getDurationMs() const    { return durationMs; }
    float getBpm() const           { return bpm; }
    float getPitch() const         { return pitch; }
    float getCuePointMs() const    { return cuePointMs; }
    int   getTrackId() const       { return trackId; }
    uint8_t getBeatPhase() const;

    juce::String getTitle() const      { return title; }
    juce::String getArtist() const     { return artist; }
    juce::String getDeviceName() const { return deviceName; }

    void setPitch(float p)  { pitch = p; }
    void setVolume(float v) { volume = v; }
    void setDeviceName(const juce::String& n) { deviceName = n; }

    void fillLayerState(LayerState& ls) const;
    const std::vector<DetailedWaveformPoint>& getWaveformData() const { return wfData; }

private:
    std::vector<DetailedWaveformPoint> analyzeAudio(
        const juce::AudioBuffer<float>& buffer, double sampleRate);
    float detectBpm(const juce::AudioBuffer<float>& buffer, double sampleRate);

    juce::AudioBuffer<float> audioBuffer;
    double fileSampleRate = 44100.0;
    double deviceSampleRate = 44100.0;

    std::atomic<PlayState> state { PlayState::IDLE };
    std::atomic<float> positionMs { 0.0f };
    std::atomic<int> playSamplePos { 0 };

    float durationMs = 0.0f;
    float bpm = 0.0f;
    float pitch = 0.0f;
    float volume = 1.0f;
    float cuePointMs = 0.0f;
    int   trackId = 0;

    juce::String title;
    juce::String artist;
    juce::String deviceName = "CDJ-3000";

    std::vector<DetailedWaveformPoint> wfData;
    static int nextTrackId;
};
