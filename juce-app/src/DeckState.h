#pragma once
#include <JuceHeader.h>
#include <array>
#include <vector>

// Play state matching TCNet / Pro DJ Link
enum class PlayState : uint8_t
{
    IDLE       = 0,
    LOADING    = 1,
    PLAYING    = 3,
    LOOPING    = 4,
    PAUSED     = 5,
    STOPPED    = 6,
    CUED       = 7,
    CUEING     = 8,
    SEEKING    = 9,
    REVERSE    = 10,
    ENDED      = 11
};

inline PlayState p1ToPlayState(uint8_t p1)
{
    switch (p1)
    {
        case 0x00: return PlayState::IDLE;
        case 0x02: return PlayState::STOPPED;
        case 0x03: return PlayState::PLAYING;
        case 0x04: return PlayState::LOOPING;
        case 0x05: return PlayState::PAUSED;
        case 0x06: case 0x07: case 0x08: return PlayState::CUED;
        case 0x09: case 0x0D: return PlayState::STOPPED;
        case 0x11: return PlayState::REVERSE;
        case 0x13: return PlayState::CUEING;
        default:   return PlayState::IDLE;
    }
}

inline uint8_t toTCNetState(PlayState s)
{
    switch (s)
    {
        case PlayState::PLAYING: case PlayState::LOOPING:  return 1;
        case PlayState::PAUSED:  case PlayState::CUED:
        case PlayState::CUEING:                            return 2;
        case PlayState::STOPPED: case PlayState::ENDED:     return 3;
        case PlayState::SEEKING:                           return 4;
        case PlayState::REVERSE:                           return 5;
        case PlayState::IDLE: case PlayState::LOADING:
        default:                                           return 0;
    }
}

inline juce::String playStateToString(PlayState s)
{
    switch (s)
    {
        case PlayState::IDLE:    return "IDLE";
        case PlayState::LOADING: return "LOADING";
        case PlayState::PLAYING: return "PLAYING";
        case PlayState::LOOPING: return "LOOPING";
        case PlayState::PAUSED:  return "PAUSED";
        case PlayState::STOPPED: return "STOPPED";
        case PlayState::CUED:    return "CUED";
        case PlayState::CUEING:  return "CUEING";
        case PlayState::SEEKING: return "SEEKING";
        case PlayState::REVERSE: return "REVERSE";
        case PlayState::ENDED:   return "ENDED";
        default:                 return "???";
    }
}

// Layer state for TCNet broadcasting
struct LayerState
{
    PlayState state    = PlayState::IDLE;
    float timecodeMs   = 0.0f;
    float totalLengthMs = 0.0f;
    float bpm          = 0.0f;
    float pitch        = 0.0f;
    int   trackId      = 0;
    uint8_t beatPhase  = 0;
    juce::String trackName;
    juce::String artistName;
    juce::String deviceName;
    int64_t updateTime = 0;   // juce::Time::currentTimeMillis()
    // CDJ HW flags
    bool sync   = false;
    bool master = false;
    bool onAir  = false;
    bool hasTrack = false;
    float trackBpm = 0.0f;   // original (non-pitch-adjusted) BPM
};

// CDJ status from PDJL
struct CDJStatus
{
    int playerNum       = 0;
    PlayState state     = PlayState::IDLE;
    float trackBpm      = 0.0f;
    float effectiveBpm  = 0.0f;
    float pitch         = 0.0f;
    int   beatNum       = 0;
    int   beatInBar     = 0;
    int   barsRemaining = 0;
    int   trackId       = 0;
    int   trackDeviceId = 0;
    int   slot          = 0;
    int   trackType     = 0;
    bool  sync = false, master = false, onAir = false, hasTrack = false;
    juce::String name;
};

struct DJMStatus
{
    std::array<float, 4> faders = {0, 0, 0, 0};
    std::array<bool, 4>  onAir  = {false, false, false, false};
};

struct BeatGridEntry
{
    int   beatInBar = 0;
    float bpm      = 0.0f;
    float timeMs   = 0.0f;
};

struct CuePoint
{
    juce::String name;
    float timeMs   = 0.0f;
    int   hotCueNum = 0;
    int   colorId   = 0;
    bool  isHotCue  = false;
};

struct WaveformPoint
{
    uint8_t height = 0;
    uint8_t color  = 0;
};

struct DetailedWaveformPoint
{
    float peak   = 0.0f;
    float bass   = 0.0f;
    float mid    = 0.0f;
    float treble = 0.0f;
    float rms    = 0.0f;
};

struct DeviceInfo
{
    juce::String type;
    int playerNum = 0;
    juce::String name;
    juce::String ip;
    int64_t lastSeen = 0;
    bool isVirtual   = false;
};

struct TCNetNode
{
    juce::String name;
    juce::String vendor;
    juce::String device;
    uint8_t nodeType = 0;
    juce::String ip;
    int port          = 0;
    int listenerPort  = 0;
    int64_t lastSeen  = 0;
};
