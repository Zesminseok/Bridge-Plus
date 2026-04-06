cmake_minimum_required(VERSION 3.22)
project(BridgePlus VERSION 0.8.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE framework
add_subdirectory(/tmp/JUCE ${CMAKE_BINARY_DIR}/JUCE)

juce_add_gui_app(BridgePlus
    PRODUCT_NAME "Bridge+"
    BUNDLE_ID "com.bridgeplus.app"
    COMPANY_NAME "BridgePlus"
    ICON_BIG ""
)

juce_generate_juce_header(BridgePlus)

target_sources(BridgePlus PRIVATE
    src/Main.cpp
    src/MainComponent.cpp
    src/WaveformComponent.cpp
    src/NetworkEngine.cpp
)

target_compile_definitions(BridgePlus PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:BridgePlus,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:BridgePlus,JUCE_VERSION>"
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(BridgePlus PRIVATE
    juce::juce_core
    juce::juce_gui_basics
    juce::juce_gui_extra
    juce::juce_graphics
    juce::juce_opengl
    juce::juce_audio_basics
    juce::juce_audio_formats
    juce::juce_audio_utils
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
)
