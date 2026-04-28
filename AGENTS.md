## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)


<claude-mem-context>
# Memory Context

# [bridge-clone] recent context, 2026-04-29 6:30am GMT+9

Legend: 🎯session 🔴bugfix 🟣feature 🔄refactor ✅change 🔵discovery ⚖️decision 🚨security_alert 🔐security_note
Format: ID TIME TYPE TITLE
Fetch details: get_observations([IDs]) | Search: mem-search skill

Stats: 50 obs (29,660t read) | 1,140,509t work | 97% savings

### Apr 24, 2026
S21 Deploy GitHub Actions Windows build workflow to main branch (Apr 24 at 9:24 PM)
S24 GitHub Actions Windows build workflow deployed and triggered (Apr 24 at 9:25 PM)
S25 Deploy GitHub Actions Windows build workflow after resolving authentication and trigger first build (Apr 24 at 9:28 PM)
S28 Replace cross-compiled Windows distribution artifacts with native-compiled builds from GitHub Actions (Apr 24 at 9:31 PM)
S30 Confirm final Windows distribution state after replacing builds with native-compiled artifacts (Apr 24 at 9:54 PM)
S41 Download GitHub Actions artifacts for v0.8.0 Windows build and replace old distribution files (Apr 24 at 9:54 PM)
S77 Codex code review workflow formalized as three-stage security-first delegation pattern (Apr 24 at 10:12 PM)
### Apr 29, 2026
S78 Security hardening implementation and regression test coverage following Codex three-stage review (security → code quality → optimization) (Apr 29 at 12:37 AM)
S79 Validate security fix impact on normal operation - verify TCNet/PDJL/Art-Net whitelists allow all legitimate user workflows (Apr 29 at 12:38 AM)
S80 Codex 보안 감사 후속 작업 - HIGH/MED 위험 수정 + PDJL parser 최적화 (Apr 29 at 12:59 AM)
3004 4:00a ✅ TDD test cases added for IPC waveform pts packing before implementation
3005 4:01a 🟣 IPC waveform payload packing implemented with backward-compatible renderer unpacking
3006 " 🔄 Renderer IPC waveform listeners refactored to detect and unpack Uint8Array format
3007 4:02a 🟣 IPC waveform packing optimization complete with all tests passing
3008 " 🟣 IPC waveform packing optimization completed and verified with full test coverage
3009 4:07a 🔵 dbserver TCP connection architecture mapped for session reuse optimization
3010 4:08a 🔄 TCP socket options optimized for dbserver connections (Option A)
3011 4:13a 🔄 TCP socket optimization for dbserver protocol connections
3012 4:28a 🔵 Dbserver TCP connection architecture mapped before implementing session reuse
3013 " 🟣 Dbserver session pooling tests added before implementation using TDD
3014 4:29a 🟣 Dbserver TCP session pooling infrastructure implemented with mutex and idle TTL
3015 4:30a 🔄 All 10 dbserver methods refactored to use pooled TCP sessions instead of fresh connections
3016 " ✅ Dbserver session pooling implementation completed with all 161 tests passing
3017 4:39a 🔐 License service disabled stub with bypassable flag lacks validation and persistence
3018 " 🔐 preload.js exposes 60+ IPC channels via contextBridge without dynamic injection risk
3019 " 🚨 rgbwf-worker.js lacks postMessage input validation allowing DoS via malformed parameters
3020 " 🚨 pcm-worker.js lacks input validation causing TypeError on malformed postMessage
3021 4:41a 🔐 BrowserWindow configured with secure Electron isolation flags
3022 " 🚨 bridge-audio:// custom protocol validates temp file Set membership but lacks path traversal guards
3023 " 🚨 macOS build disables hardened runtime and notarization preventing Gatekeeper protection
3024 " 🚨 OffscreenCanvas size validation missing allowing DoS via memory exhaustion
3025 " 🔐 Web Worker postMessage wrapper validates job tokens and cleans up on fatal errors
3026 4:57a 🔵 Virtual deck module extraction scope analyzed for Phase 5.2 refactoring
3027 4:59a 🔄 Virtual deck helpers extracted into standalone module
3028 5:00a 🔄 Virtual deck helpers extracted into bridge/virtual-deck.js module (Phase 5.2)
3029 " 🔴 Test failure fixed after virtual-deck refactor by documenting rate-limit guard location
3030 5:01a ✅ Phase 5.2 virtual-deck refactor completed with all verification steps passing
3031 5:18a 🔵 BridgeCore dbserver client session pool architecture uses Map-based mutex pattern with 30s idle TTL
3032 " 🔵 Existing modularization uses fn(core, ...args) wrapper pattern for stateful bridge components
3033 " 🔵 dbserver response parsing uses _dbReadField recursive TLV parser with _dbParseItems magic-scan loop
3034 " 🔵 Nine dbserver request methods share identical acquire/release/invalidate session discipline and cache/callback side effects
3035 5:25a 🔵 Phase 5.3c baseline: bridge-core.js state before dbserver client extraction
3036 5:26a 🔵 Dependency analysis for dbserver client extraction identified _dbgLog and core references
3037 " 🔵 Precise method boundaries parsed for 11 dbserver clients using JavaScript AST extraction
3038 5:27a 🔄 Phase 5.3c extraction completed: 11 dbserver client methods moved to bridge/dbserver-client.js
3039 " ✅ Phase 5.3c extraction verified: all this→core substitutions complete and modules syntactically valid
3040 5:28a 🔴 Fixed trailing newline whitespace discrepancy in extracted dbserver client method bodies
3041 " 🔵 Test failure after Phase 5.3c extraction: test checks bridge-core.js method bodies but logic now in bridge/dbserver-client.js
3042 5:29a ✅ Added inline comments to wrapper methods documenting session acquisition moved to bridge/dbserver-client.js
3043 " ✅ Phase 5.3c extraction complete: all 157 tests passing after adding _scheduleDbFollowUps reference to comment
3044 5:30a ✅ Phase 5.3c final state verified: 2508-line bridge-core.js + 849-line bridge/dbserver-client.js ready for commit
3045 5:35a 🔵 Phase 5.3 dbserver refactor correctness verification completed
3046 5:36a 🔵 Phase 5.3 dbserver refactor correctness review: all 5 critical checks passed
3047 5:51a 🔵 BRIDGE+ performance review identified 5 hot-path GC pressure findings in UDP and status modules
3048 5:59a 🔵 Renderer tick architecture analyzed for idle-downshift design
3049 6:12a 🔵 External specification reference audit completed for BRIDGE+ codebase
3050 6:13a 🔵 Legal compliance scan initiated for BRIDGE+ v1.0.0 public GitHub beta release
3051 " 🔵 Code comments contain packet capture analysis references documenting Pioneer protocol implementation details
3052 6:14a 🔵 Packet capture files and trademarked protocol strings identified in legal compliance audit
3053 " 🔵 External specification audit completed with classification of protocol documentation by risk severity

Access 1141k tokens of past work via get_observations([IDs]) or mem-search skill.
</claude-mem-context>