{
  "targets": [{
    "target_name": "abletonlink_mini",
    "sources": [
      "src/link-mini.cc"
    ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "<(module_root_dir)/third_party/link/include",
      "<(module_root_dir)/third_party/link/modules/asio-standalone/asio/include"
    ],
    "cflags_cc!": [ "-fno-exceptions", "-fno-rtti", "-std=gnu++14", "-std=c++14" ],
    "cflags_cc": [ "-frtti", "-fexceptions", "-std=c++17" ],
    "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
    "conditions": [
      ["OS==\"mac\"", {
        "defines": [ "LINK_PLATFORM_MACOSX=1" ],
        "xcode_settings": {
          "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
          "GCC_ENABLE_CPP_RTTI": "YES",
          "CLANG_CXX_LIBRARY": "libc++",
          "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
        }
      }],
      ["OS==\"linux\"", {
        "defines": [ "LINK_PLATFORM_LINUX=1" ]
      }],
      ["OS==\"win\"", {
        "defines": [
          "LINK_PLATFORM_WINDOWS=1",
          "_WIN32_WINNT=0x0601",
          "WIN32_LEAN_AND_MEAN",
          "NOMINMAX"
        ],
        "msvs_settings": {
          "VCCLCompilerTool": {
            "ExceptionHandling": 1,
            "RuntimeTypeInfo": "true",
            "AdditionalOptions": [ "/std:c++17", "/EHsc" ]
          }
        },
        "libraries": [ "-lIphlpapi", "-lWinmm" ]
      }]
    ]
  }]
}
