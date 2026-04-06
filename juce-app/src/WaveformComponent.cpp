#include "WaveformComponent.h"
using namespace juce::gl;

// Vertex shader: position + color per vertex
const char* WaveformComponent::vertexShaderSource = R"(
    attribute vec2 aPos;
    attribute vec3 aColor;
    varying vec3 vColor;
    uniform vec2 uResolution;

    void main()
    {
        vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
        clip.y = -clip.y;
        gl_Position = vec4(clip, 0.0, 1.0);
        vColor = aColor;
    }
)";

// Fragment shader: per-vertex interpolated color
const char* WaveformComponent::fragmentShaderSource = R"(
    varying vec3 vColor;

    void main()
    {
        gl_FragColor = vec4(vColor, 1.0);
    }
)";

WaveformComponent::WaveformComponent()
{
    openGLContext.setRenderer(this);
    openGLContext.attachTo(*this);
    openGLContext.setContinuousRepainting(true);
}

WaveformComponent::~WaveformComponent()
{
    openGLContext.detach();
}

void WaveformComponent::setWaveformData(std::vector<WaveformPoint>&& data)
{
    std::lock_guard<std::mutex> lock(dataMutex);
    wfData = std::move(data);
}

void WaveformComponent::setPosition(float pos)
{
    position.store(juce::jlimit(0.0f, 1.0f, pos));
}

void WaveformComponent::setZoomMs(float ms)
{
    zoomMs.store(juce::jmax(500.0f, ms));
}

void WaveformComponent::setDuration(float durMs)
{
    duration.store(durMs);
}

void WaveformComponent::paint(juce::Graphics&) {}
void WaveformComponent::resized() {}

void WaveformComponent::newOpenGLContextCreated()
{
    shader = std::make_unique<juce::OpenGLShaderProgram>(openGLContext);

    if (!shader->addVertexShader(vertexShaderSource) ||
        !shader->addFragmentShader(fragmentShaderSource) ||
        !shader->link())
    {
        DBG("Shader error: " + shader->getLastError());
        shader = nullptr;
        return;
    }

    openGLContext.extensions.glGenVertexArrays(1, &vao);
    openGLContext.extensions.glGenBuffers(1, &vbo);
}

void WaveformComponent::buildVertexData(std::vector<float>& vertices, int W, int H)
{
    std::lock_guard<std::mutex> lock(dataMutex);

    if (wfData.empty() || duration.load() <= 0.0f)
        return;

    const float pos = position.load();
    const float dur = duration.load();
    const float zoom = zoomMs.load();
    const float posMs = pos * dur;
    const float msPerPx = zoom / (float)W;
    const float mid = (float)H * 0.5f;
    const float cX = (float)W * 0.5f;
    const int pts = (int)wfData.size();
    const float pxPerMs = (float)pts / dur;

    vertices.reserve((size_t)(W * 2 * 5));

    for (int px = 0; px < W; px++)
    {
        float ms = posMs + ((float)px - cX) * msPerPx;
        float di = ms * pxPerMs;
        int i0 = juce::jlimit(0, pts - 1, (int)di);
        int i1 = juce::jmin(pts - 1, i0 + 1);
        float frac = di - (float)i0;

        const auto& p0 = wfData[(size_t)i0];
        const auto& p1 = wfData[(size_t)i1];

        float peak = p0.peak + (p1.peak - p0.peak) * frac;
        float h = peak * mid * 0.95f;

        float r = p0.bass   + (p1.bass   - p0.bass)   * frac;
        float g = p0.mid    + (p1.mid    - p0.mid)    * frac;
        float b = p0.treble + (p1.treble - p0.treble) * frac;
        float mx = juce::jmax(r, g, b, 0.001f);
        float sc = 1.0f / mx;
        r *= sc; g *= sc; b *= sc;

        // Top vertex (bright)
        vertices.push_back((float)px);
        vertices.push_back(mid - h);
        vertices.push_back(r);
        vertices.push_back(g);
        vertices.push_back(b);

        // Bottom vertex (darker at edge)
        vertices.push_back((float)px);
        vertices.push_back(mid + h);
        vertices.push_back(r * 0.4f);
        vertices.push_back(g * 0.4f);
        vertices.push_back(b * 0.4f);
    }
}

void WaveformComponent::renderOpenGL()
{
    if (!shader) return;

    const int W = getWidth();
    const int H = getHeight();

    juce::OpenGLHelpers::clear(juce::Colour(0xff111318));

    std::vector<float> vertices;
    buildVertexData(vertices, W, H);
    if (vertices.empty()) return;

    openGLContext.extensions.glBindVertexArray(vao);
    openGLContext.extensions.glBindBuffer(GL_ARRAY_BUFFER, vbo);
    openGLContext.extensions.glBufferData(GL_ARRAY_BUFFER,
        (GLsizeiptr)(vertices.size() * sizeof(float)), vertices.data(), GL_DYNAMIC_DRAW);

    shader->use();
    shader->setUniform("uResolution", (float)W, (float)H);

    GLuint posAttr = (GLuint)openGLContext.extensions.glGetAttribLocation(shader->getProgramID(), "aPos");
    GLuint colAttr = (GLuint)openGLContext.extensions.glGetAttribLocation(shader->getProgramID(), "aColor");

    openGLContext.extensions.glEnableVertexAttribArray(posAttr);
    openGLContext.extensions.glVertexAttribPointer(posAttr, 2, GL_FLOAT, GL_FALSE,
        5 * (GLsizei)sizeof(float), nullptr);

    openGLContext.extensions.glEnableVertexAttribArray(colAttr);
    openGLContext.extensions.glVertexAttribPointer(colAttr, 3, GL_FLOAT, GL_FALSE,
        5 * (GLsizei)sizeof(float), (void*)(2 * sizeof(float)));

    glDrawArrays(GL_TRIANGLE_STRIP, 0, (GLsizei)(vertices.size() / 5));

    openGLContext.extensions.glDisableVertexAttribArray(posAttr);
    openGLContext.extensions.glDisableVertexAttribArray(colAttr);
    openGLContext.extensions.glBindBuffer(GL_ARRAY_BUFFER, 0);
    openGLContext.extensions.glBindVertexArray(0);
}

void WaveformComponent::openGLContextClosing()
{
    shader = nullptr;
    if (vbo) { openGLContext.extensions.glDeleteBuffers(1, &vbo); vbo = 0; }
    if (vao) { openGLContext.extensions.glDeleteVertexArrays(1, &vao); vao = 0; }
}
