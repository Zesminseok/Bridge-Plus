#include <JuceHeader.h>
#include "MainComponent.h"

class BridgePlusApp : public juce::JUCEApplication
{
public:
    BridgePlusApp() {}

    const juce::String getApplicationName() override    { return "Bridge+"; }
    const juce::String getApplicationVersion() override { return "0.9.0"; }
    bool moreThanOneInstanceAllowed() override          { return false; }

    void initialise(const juce::String&) override
    {
        mainWindow.reset(new MainWindow(getApplicationName()));
    }

    void shutdown() override
    {
        mainWindow = nullptr;
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow(juce::String name)
            : DocumentWindow(name,
                juce::Colour(0xff111318), // dark background
                DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainComponent(), true);
            setResizable(true, true);
            setResizeLimits(900, 680, 3840, 2160);
            centreWithSize(getWidth(), getHeight());
            setVisible(true);
        }

        void closeButtonPressed() override
        {
            JUCEApplication::getInstance()->systemRequestedQuit();
        }

    private:
        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

private:
    std::unique_ptr<MainWindow> mainWindow;
};

START_JUCE_APPLICATION(BridgePlusApp)
