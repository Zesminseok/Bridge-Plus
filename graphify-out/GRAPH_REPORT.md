# Graph Report - /Users/zes2021/Documents/claude_projects/bridge-clone  (2026-04-29)

## Corpus Check
- 60 files · ~258,662 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 915 nodes · 1419 edges · 64 communities detected
- Extraction: 79% EXTRACTED · 21% INFERRED · 0% AMBIGUOUS · INFERRED: 294 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]
- [[_COMMUNITY_Community 58|Community 58]]
- [[_COMMUNITY_Community 59|Community 59]]
- [[_COMMUNITY_Community 60|Community 60]]
- [[_COMMUNITY_Community 61|Community 61]]
- [[_COMMUNITY_Community 62|Community 62]]
- [[_COMMUNITY_Community 63|Community 63]]

## God Nodes (most connected - your core abstractions)
1. `BridgeCore` - 85 edges
2. `push()` - 53 edges
3. `TCNet Link Specification V3.5.1B (02/03/2022)` - 33 edges
4. `ArtnetEngine` - 26 edges
5. `send()` - 20 edges
6. `Player 1 Row — Daft Punk — Children Of The Night` - 17 edges
7. `WaveformGL` - 14 edges
8. `getAllInterfaces()` - 14 edges
9. `OverviewGL` - 13 edges
10. `buildHdr()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `push()` --calls--> `parsePcapng()`  [INFERRED]
  /Users/zes2021/Documents/claude_projects/bridge-clone/main.js → tools/pcap-replay.js
- `push()` --calls--> `buildDbMsg()`  [INFERRED]
  /Users/zes2021/Documents/claude_projects/bridge-clone/main.js → tools/pcap-replay.js
- `push()` --calls--> `buildMenuItem()`  [INFERRED]
  /Users/zes2021/Documents/claude_projects/bridge-clone/main.js → tools/pcap-replay.js
- `v0.8.0 DJM-900NXS2 Mixer Parsing + TCNet VU` --conceptually_related_to--> `DSEG7 timecode font (deprecated, replaced by monospace)`  [INFERRED]
  CHANGELOG.md → renderer/index.html
- `node-tcnet library (TypeScript TCNet impl)` --implements_protocol--> `TCNet Link Specification V3.5.1B (02/03/2022)`  [EXTRACTED]
  package/README.MD → TCNet-V3-5-1B.pdf

## Hyperedges (group relationships)
- **PDJL 4-document reference collection** — pdjl_readme_complete_set, pdjl_index_navigation, pdjl_protocol_ref_overview, pdjl_byte_offsets_universal_header, pdjl_impl_virtual_cdj_setup [EXTRACTED 1.00]
- **DJ Link UDP port architecture** — deepsymmetry_packets_header, deepsymmetry_packets_port50000, deepsymmetry_packets_port50001, deepsymmetry_packets_port50002, deepsymmetry_packets_port50004 [EXTRACTED 1.00]
- **Onyx Studio 3-layer token system** — renderer_index_onyx_tokens, renderer_index_semantic_tokens, renderer_index_component_defaults, renderer_index_legacy_alias [EXTRACTED 1.00]
- **Black + Orange Studio Dark theme family** —  [INFERRED 0.85]
- **Deck-structure-preserving proposals that only swap :root token palette** —  [INFERRED 0.80]
- **TCNet node discovery + liveness protocol (Opt-IN/Opt-OUT/Status on port 60000 every 1000ms)** —  [EXTRACTED 1.00]
- **** — refine_row_deck_module, refine_row_waveform, refine_row_timecode, refine_row_bpm [INFERRED 0.60]
- **Left sidebar module navigation set** —  [INFERRED 1.00]
- **Header control cluster (status + transport + master)** —  [INFERRED 1.00]
- **Status bar telemetry fields** —  [INFERRED 0.70]
- **Atelier proposal composition: header + 2x2 deck grid + mixer column + bottom bar** — atelier_full_page, atelier_full_deck_grid, atelier_full_mixer_panel, atelier_full_bottom_bar [INFERRED 1.00]
- **Editorial studio dark visual language (palette + timecode typography + colored waveforms)** — atelier_full_palette, atelier_full_timecode, atelier_full_waveform_style [INFERRED 0.90]
- **AFTER Row layout composition (horizontal 1-deck-per-row)** — refine_row_final_artwork, refine_row_final_player_badge, refine_row_final_title_meta, refine_row_final_waveform, refine_row_final_vu_meter, refine_row_final_timecode, refine_row_final_bpm_block, refine_row_final_transport_row, refine_row_final_sync_row, refine_row_final_device_meta [INFERRED]
- **Design spec decisions (typography, separator, width, spacing, order)** — refine_row_final_spec_typography, refine_row_final_spec_separator, refine_row_final_spec_artist_width, refine_row_final_spec_letter_spacing, refine_row_final_spec_css_order [INFERRED]
- **BEFORE vs AFTER comparative structure** — refine_row_final_before_section, refine_row_final_after_section, refine_row_final_root [INFERRED]

## Communities

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (44): BridgeCore, sendInterfaces(), detectBroadcastFor(), getAllInterfaces(), _getHWPortMap(), interfaceSignature(), pdjlBroadcastTargets(), _runNetSetup() (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (54): analyzeBPM(), detectAudioStart(), _dbgLog(), _resolveDbgLogPath(), _findByNameUnix(), _findByNameWin(), _findByPortUnix(), _findByPortWin() (+46 more)

### Community 2 - "Community 2"
Cohesion: 0.04
Nodes (57): dbserver artwork TCP 12523, DJM 0x39 EQ byte offset calibration (live test), EQ knob arc (12 o'clock Boost/Cut), IPC channels (bridge:wfpreview, bridge:albumart, bridge:requestArtwork, bridge:tcmixervu), TCNet MixerData DataType150 reception, v0.6.0 CDJ waveform preview + artwork, v0.7.0 BRIDGE+ Onyx Studio design, v0.8.0 DJM-900NXS2 Mixer Parsing + TCNet VU (+49 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (45): dysentery (Java by Deep-Symmetry), prolink-connect (JS by EvanPurkhiser), Pioneer DJ Pro DJ Link Bridge, Showkontrol / Beatkontrol (TC Supply), node-tcnet library (TypeScript TCNet impl), Rationale: documented TCNet protocol over reverse-engineered Pro DJ Link, node-tcnet README, dev@eiglive.com contact (+37 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (10): ArtnetEngine, createWindow(), doQuit(), getLocalIp(), LinkBridge, loadBounds(), saveBounds(), sendArtTimeCode() (+2 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (21): nxs2BeatCountToMs(), shouldKeepPredictedBeatAnchor(), test(), _isIPv4(), buildBridgeNotifyPacket(), buildDbServerKeepalivePacket(), buildDjmSubscribePacket(), buildPdjlBridgeClaimPacket() (+13 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (38): AFTER · 리파인 Label, Artist — Title: Daft Punk — Children Of The Night, Artwork Tile — HOMEWORK (orange thumbnail), BEFORE · 현재 Label, BPM Display 128.00 BPM (orange pill), BPM Meta — 124.00 · +3.23% · 8A, CDJ-3000 Model Tag, EQ Knobs HI/MID/LO (three stacked) (+30 more)

### Community 7 - "Community 7"
Cohesion: 0.1
Nodes (22): applyDom(), detectSystemLang(), getSavedPref(), setLang(), t(), bind(), paintStatus(), refresh() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (6): OverviewGL, WaveformGL, _wglIsPackedWaveform(), _wglPoolRow(), _wglWaveformLength(), _wglWritePoint()

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (20): clamp01(), dot(), mix(), monoColor(), rgbTraceColor(), sat(), bandHeights(), clamp() (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.1
Nodes (25): AFTER card (리파인된), Artist meta: Daft Punk · HOMEWORK (11px), BEFORE card (before state), BPM block 128.00 · pitch +3.23% · 8A key, CDJ-3000 device tag, Header: F · CARD · 히어로 아트 360px, Header actions: 패딩 통일 · pnum 확대 · 타이틀 위치 swap, Hero artwork — orange gradient 360px (+17 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (23): confidence_score=0.86, Deck card — PLAYER 01 CDJ-3000X orange hero, Deck1 vertical channel fader (FADER 100), Deck1 header: PLAYER 01 · CDJ-3000X · PLAY/SYNC/MASTER/ON AIR badges, Deck1 channel strip knobs: TRIM / HI / MID / LOW / COLOR, Deck1 meta row: REM 04:10 · CUE 0:32.1 · LOOP — · SLIP OFF, Deck1 timecode 01:24:18 · BPM 128.00 · +0.0% · 128.00 orig · SA, Deck1 track title: Children Of The Night — Daft Punk · Homework (Remastered) (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.1
Nodes (22): BRIDGE+ PRO DJ LINK application (idle state), Korean prompt banner: 'START를 눌러 TCNet을 시작하세요', Hint text: 'CDJ 연결 시 자동 감지됩니다' (auto-detect on CDJ connect), Dark theme with orange accent color palette, DECK MODE toggle: VIRTUAL | HARDWARE (HARDWARE selected), Empty central deck/content canvas (no decks rendered, pre-START), Top header with B+ logo, BRIDGE+ title, PRO DJ LINK subtitle, Application idle/pre-start state (TCNet not yet started) (+14 more)

### Community 13 - "Community 13"
Cohesion: 0.11
Nodes (21): Deck A BPM 128.00, Deck B BPM 119.00, Dark theme with per-deck accent colors, Deck A row (orange), Deck B row (blue), Header bar — 'ROW · 가로 풀폭', Layout pattern — horizontal full-width deck rows, Deck A mini controls cluster (+13 more)

### Community 14 - "Community 14"
Cohesion: 0.16
Nodes (19): Card Deck 1 — PLAYER #1 orange, Children Of The Night, full waveform + transport, Card Deck 2 — PLAYER #2 purple, Let It Happen (Soulwax Remix), waveform + transport, Dark theme background — editorial studio dark palette (ATELIER style), Top Header Bar — BRIDGE · Tower · Card · Row · Developed title + status metrics, Header legend row — Low batch / High stretch / Overdub / LoopTools tags, BRIDGE Tower-Card-Row Developed Preview v2 (Full UI), Row Deck 1 — Children Of The Night, horizontal waveform, TC 01:24:18, 128 BPM, Row Deck 2 — Let It Happen (Soulwax Remix), horizontal waveform, TC 00:48:04 (+11 more)

### Community 15 - "Community 15"
Cohesion: 0.12
Nodes (18): AFTER (이후) — 개선된 Row 레이아웃 스크린샷, Artwork 썸네일 (좌측 정사각형, NO ARTWORK 플레이스홀더), BEFORE (이전) — 기존 Row 레이아웃 스크린샷, BPM 128.00 · 124.00 · +3.23% · 8A 키 표시 블록, 디바이스 메타 — CDJ-3000 · SYNC · MASTER 상태, PLAYER 1 · PLAY 상태 뱃지, Refine Row Final — 가로 풀폭 1덱=1행 레이아웃, Artist max-width 40% — 긴 이름 줄임표 처리 (+10 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (18): Card AFTER — 리파인 (Player 1 PLAY, hero art 확대, title 위로 swap, BPM meta 9px, TC 조정, safety u3 12px), Badge: PLAYER 1 PLAY (accent orange), Card BEFORE — 현재 (Player 1 PLAY, Daft Punk · HOMEWORK, Children Of The Night, 00:01:24:12, 128.00 BPM, CDJ-3000, SYNC MASTER, VU meter, transport CUE/II/|◀, safety MASTER/A/B), BPM 128.00 + meta 124.00 +1.23% (9px), Hero Artwork 360px (orange/amber gradient), Meta: Daft Punk · HOMEWORK / Children Of The Night, Safety row: MASTER / A / B, Scrub/progress bar + knobs row (+10 more)

### Community 17 - "Community 17"
Cohesion: 0.23
Nodes (18): Player 01 Tower — Children Of The Night / Daft Punk (orange theme, PLAY active), Player 02 Tower — Let It Happen (Soulwax) / Tame Impala (purple theme, CUE), Player 03 Tower — Butterflies / Leon Vynehall (blue theme, STOP), Player 04 Tower — empty/disconnected placeholder, 4-Column Tower Grid (Player 01 / 02 / 03 / 04), Top Legend Bar (Low band / High band / Downbeat / COLOR FX / Level·Fader), Preview v2 Tower — DJ Bridge Vertical Strip Layout, Section Title — 'TOWER · 세로 스트립 218px 매핑 스트립 하션 통합' (+10 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (18): AFTER · 리파인 panel, AFTER Player 1 tower card (refined), AFTER Player 2 tower card (EMPTY SLOT / DROP TRACK), Artwork thumbnail (HOMEWORK), BEFORE · 현재 panel, BEFORE Player 1 tower card (PLAY/SYNC/MASTER, CDJ-3000), BEFORE Player 2 tower card (EMPTY, 빈 덱), BPM 128.00 chip + meta (124.00 · +3.23% · 8A) at 10px (+10 more)

### Community 19 - "Community 19"
Cohesion: 0.2
Nodes (16): BPM + transport metadata cluster — small pill/tag row beside timecode, Deck 1 — '1 Children Of The Night', orange/amber waveform, TC 01:24:18, 128 BPM, Deck 2 — '2 Around The World (Jean-Baptiste Reworx)', teal waveform, TC 00:48:04, 125 BPM, Deck 3 — '3 Technologic', blue waveform, TC 00:16:00, 125 BPM, Deck 4 — '4 Something About Us', violet/magenta waveform, TC 00:24:00, 120 BPM, 2x2 deck grid — four editorial-style track panels on dark background, Header bar — 'Bridge' wordmark (serif, left) + 'Warehouse / Session 01' label (right), Layout — header + 2x2 deck grid + right-rail sidebar; dense but airy studio aesthetic (+8 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (16): Card Deck 1 — Children Of The Night, Card Deck 2 — Let It Happen (Soulwax Remix), Design Tokens (inferred), Header Bar, BRIDGE+ Layout Variants v3 (Full TV/Monitor), Row Deck 1 — Children Of The Night (00:01:24:12), Row Deck 2 — Let It Happen (00:00:48:00), Scaling / Responsive Behavior (+8 more)

### Community 21 - "Community 21"
Cohesion: 0.14
Nodes (15): Design guideline: preserve deck structure, only change theme/density, Magazine spread metaphor (deck = chapter, ivory+brass on dark), Before/After Split Grid (.ba), Deck Card (.dk) component, Density Pass (padding/gap compression redesign), BRIDGE+ Density Pass (before x after), App CSS Design Tokens (:root), LIVE badge with pulse animation (+7 more)

### Community 22 - "Community 22"
Cohesion: 0.15
Nodes (15): Bar Counter widget, 16-step Beat Ring indicators, Dark theme background (develop preview style), Deck A Waveform Row (Children of the Night - Soft Punks, TC 01:24:18), Deck B Waveform Row (Children of the Night - Soft Punks, TC 01:24:18), Header: BRIDGE Develop Preview, Metadata strip (Key/BPM/Time details), Channel faders and crossfader (+7 more)

### Community 23 - "Community 23"
Cohesion: 0.41
Nodes (11): _mxBuildBody(), _mxClearCache(), _mxDetectProfile(), _mxEl(), _mxEnsureAuxKnobs(), _mxKnobSVG(), _mxKnobUpdate(), _mxMountKnob() (+3 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (11): Blank/white render - possible rendering failure, BPM readout (inferred), Deck module (inferred), DJ Bridge UI context, Horizontal row-oriented deck layout, refine-row.png screenshot (appears blank/white), Row layout variant (refinement), Phase meter (inferred) (+3 more)

### Community 25 - "Community 25"
Cohesion: 0.33
Nodes (5): _histAddEntry(), _histFinalizeOnAir(), _histOnAirChange(), _histOnNewTrack(), renderHistory()

### Community 26 - "Community 26"
Cohesion: 0.36
Nodes (8): analyze(), _bq(), buildHtml(), decodeWav(), _mkBQ(), _mkHP(), rgbTraceColor(), smoothEnv()

### Community 27 - "Community 27"
Cohesion: 0.25
Nodes (1): FakeBridgeCore

### Community 28 - "Community 28"
Cohesion: 0.52
Nodes (6): analyzeWf(), _bq(), _mkBQ(), _mkHP(), movingAverage(), smoothEnv()

### Community 29 - "Community 29"
Cohesion: 0.57
Nodes (6): _findAIFFId3(), _id3ApplyTextFrame(), _id3DecodeText(), _id3DecodeTxxx(), _id3ParseBpm(), readID3Tags()

### Community 30 - "Community 30"
Cohesion: 0.48
Nodes (1): LTCProcessor

### Community 31 - "Community 31"
Cohesion: 0.29
Nodes (7): Bottom transport/status bar spanning full width — fine tick-marks timeline, small status chips/icons, muted dark background, 2x2 deck grid (4 decks): 'Children Of The Night', 'Around The World (Guam Bapt…)', 'Technologic', 'Something About Us' — each with track title, deck meta row, waveform overview with amber/teal/green/purple accents, large monospaced timecode (e.g. 01:24:18, 00:48:04, 00:16:00, 00:00:00), BPM readout (128/125/…), knob/level indicators cluster, Right-side Mixer column with vertical channel VU bars (6 channels) in green/amber gradient, 'Crossfade' label with horizontal slider, 'Session Log' list of labeled events/tracks, Atelier — Editorial Studio Dark full-page layout (dark warm-neutral theme, brand 'Bridge' wordmark top-left, top utility bar with Warehouse/Room 01 session label and tempo/beat indicators), Color palette: deep charcoal/near-black background (#0f0d0b-ish), warm ivory text, amber/gold primary accent, secondary per-deck hue (teal, green, violet) — editorial studio dark aesthetic, Large editorial timecode typography — monospace HH:MM:SS, amber/gold tint on black, dominant visual anchor of each deck card, Waveform style: full-width per-deck mini overview with colored frequency bands (warm amber/orange for deck1, cyan-teal for deck2, green for deck3, violet/purple for deck4) on near-black panel with subtle grid

### Community 32 - "Community 32"
Cohesion: 0.6
Nodes (3): deactivate(), getStatus(), refresh()

### Community 33 - "Community 33"
Cohesion: 0.4
Nodes (5): BridgeClone class (TCNet sender), Electron bootstrap (main.js + preload.js), prolink-connect integration (Stage 3), renderer/index.html GUI scaffold, Resolume Arena Pioneer DJ TCNet reception

### Community 34 - "Community 34"
Cohesion: 0.4
Nodes (5): Card layout variant, Matrix/Row layout variant, Tower layout variant, Refine Preview - spacing/alignment/font/title compare, BRIDGE+ Layout Variants (Tower/Card/Matrix)

### Community 35 - "Community 35"
Cohesion: 0.67
Nodes (2): _packColorHeightPtsForIpc(), _packWaveformForIpc()

### Community 36 - "Community 36"
Cohesion: 0.5
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 0.67
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 0.67
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 0.67
Nodes (3): 3x2 Deck Grid Layout, Proposal A - Compact Pro, 56px Icon Sidebar (LIVE/MIX/PDJL/TCNET/ARTNET/LINK)

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

### Community 44 - "Community 44"
Cohesion: 1.0
Nodes (0): 

### Community 45 - "Community 45"
Cohesion: 1.0
Nodes (0): 

### Community 46 - "Community 46"
Cohesion: 1.0
Nodes (0): 

### Community 47 - "Community 47"
Cohesion: 1.0
Nodes (0): 

### Community 48 - "Community 48"
Cohesion: 1.0
Nodes (0): 

### Community 49 - "Community 49"
Cohesion: 1.0
Nodes (0): 

### Community 50 - "Community 50"
Cohesion: 1.0
Nodes (0): 

### Community 51 - "Community 51"
Cohesion: 1.0
Nodes (2): Proposal C - Minimal Tactical (light theme), 3-column body layout (260/flex/320)

### Community 52 - "Community 52"
Cohesion: 1.0
Nodes (2): Information priority: Timecode > Waveform > Track ID > BPM > others, Proposal G - Timecode First (Monolith) information hierarchy

### Community 53 - "Community 53"
Cohesion: 1.0
Nodes (2): Preview Develop - G.ROW + Waveform 2-band + Beat Ring + Knob Arc, Preview v2 - TOWER/CARD/ROW developed with channel strip + fader

### Community 54 - "Community 54"
Cohesion: 1.0
Nodes (0): 

### Community 55 - "Community 55"
Cohesion: 1.0
Nodes (0): 

### Community 56 - "Community 56"
Cohesion: 1.0
Nodes (0): 

### Community 57 - "Community 57"
Cohesion: 1.0
Nodes (0): 

### Community 58 - "Community 58"
Cohesion: 1.0
Nodes (1): v0.5.0 Initial release

### Community 59 - "Community 59"
Cohesion: 1.0
Nodes (1): graphify workflow rules

### Community 60 - "Community 60"
Cohesion: 1.0
Nodes (1): PDJL key facts (ports, broadcast, header, BPM encoding)

### Community 61 - "Community 61"
Cohesion: 1.0
Nodes (1): Default Album Artwork Placeholder (Vinyl Disc)

### Community 62 - "Community 62"
Cohesion: 1.0
Nodes (1): Default Album Art (Vinyl/CD Placeholder)

### Community 63 - "Community 63"
Cohesion: 1.0
Nodes (1): Default Album Art (Vinyl Record Placeholder)

## Knowledge Gaps
- **243 isolated node(s):** `EQ knob arc (12 o'clock Boost/Cut)`, `v0.7.0 BRIDGE+ Onyx Studio design`, `v0.5.0 Initial release`, `renderer/index.html GUI scaffold`, `prolink-connect integration (Stage 3)` (+238 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 40`** (2 nodes): `jsString()`, `electron_analyze_waveform.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (2 nodes): `test()`, `dbserver.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (2 nodes): `test()`, `pdjl-packets.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (2 nodes): `test()`, `pdjl-parser.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 44`** (2 nodes): `test()`, `license-service.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (2 nodes): `test()`, `metadata-bpm.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 46`** (2 nodes): `registerLicenseIpc()`, `ipc-license.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (2 nodes): `registerLinkIpc()`, `ipc-link.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (2 nodes): `registerBridgeIfaceIpc()`, `ipc-bridge-iface.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 49`** (2 nodes): `registerAppIpc()`, `ipc-app.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (2 nodes): `registerBridgeSimpleIpc()`, `ipc-bridge-simple.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (2 nodes): `Proposal C - Minimal Tactical (light theme)`, `3-column body layout (260/flex/320)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 52`** (2 nodes): `Information priority: Timecode > Waveform > Track ID > BPM > others`, `Proposal G - Timecode First (Monolith) information hierarchy`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 53`** (2 nodes): `Preview Develop - G.ROW + Waveform 2-band + Beat Ring + Knob Arc`, `Preview v2 - TOWER/CARD/ROW developed with channel strip + fader`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 54`** (1 nodes): `pcm-worker.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 55`** (1 nodes): `gen-test-tones.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 56`** (1 nodes): `rename-stub.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (1 nodes): `gen-sweep-clean.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 58`** (1 nodes): `v0.5.0 Initial release`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (1 nodes): `graphify workflow rules`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 60`** (1 nodes): `PDJL key facts (ports, broadcast, header, BPM encoding)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (1 nodes): `Default Album Artwork Placeholder (Vinyl Disc)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 62`** (1 nodes): `Default Album Art (Vinyl/CD Placeholder)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `Default Album Art (Vinyl Record Placeholder)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `push()` connect `Community 1` to `Community 0`, `Community 4`, `Community 5`, `Community 7`, `Community 25`, `Community 26`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `BridgeCore` connect `Community 0` to `Community 1`, `Community 5`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `buildHtml()` connect `Community 26` to `Community 1`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 52 inferred relationships involving `push()` (e.g. with `_dbgLog()` and `._startPDJLRx()`) actually correct?**
  _`push()` has 52 INFERRED edges - model-reasoned connections that need verification._
- **Are the 13 inferred relationships involving `send()` (e.g. with `.stop()` and `._send()`) actually correct?**
  _`send()` has 13 INFERRED edges - model-reasoned connections that need verification._
- **What connects `EQ knob arc (12 o'clock Boost/Cut)`, `v0.7.0 BRIDGE+ Onyx Studio design`, `v0.5.0 Initial release` to the rest of the system?**
  _243 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.04 - nodes in this community are weakly interconnected._