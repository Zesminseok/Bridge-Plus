#pragma once
#include <JuceHeader.h>

// Per-column waveform data (from audio analysis)
struct WaveformPoint
{
    float peak = 0.0f;   // overall peak amplitude 0-1
    float bass = 0.0f;   // low band peak (IIR < 600Hz)
    float mid  = 0.0f;   // mid band peak (600-4000Hz)
    float treble = 0.0f; // high band peak (> 4000Hz)
    float rms  = 0.0f;   // RMS for height
};

class WaveformComponent : public juce::Component,
                          private juce::OpenGLRenderer
{
public:
    WaveformComponent();
    ~WaveformComponent() override;

    // Set waveform data (from audio analysis)
    void setWaveformData(std::vector<WaveformPoint>&& data);

    // Set playback position (0-1)
    void setPosition(float pos);

    // Set zoom level in milliseconds
    void setZoomMs(float ms);

    // Set track duration in ms
    void setDuration(float durMs);

    // Component overrides
    void paint(juce::Graphics& g) override;
    void resized() override;

private:
    // OpenGL renderer
    void newOpenGLContextCreated() override;
    void renderOpenGL() override;
    void openGLContextClosing() override;

    juce::OpenGLContext openGLContext;

    // Waveform data
    std::vector<WaveformPoint> wfData;
    std::mutex dataMutex;

    // Playback state
    std::atomic<float> position { 0.0f };
    std::atomic<float> zoomMs { 8000.0f };
    std::atomic<float> duration { 0.0f };

    // OpenGL resources
    std::unique_ptr<juce::OpenGLShaderProgram> shader;
    GLuint vao = 0, vbo = 0;

    // Shader source
    static const char* vertexShaderSource;
    static const char* fragmentShaderSource;

    void buildVertexData(std::vector<float>& vertices, int width, int height);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(WaveformComponent)
};
