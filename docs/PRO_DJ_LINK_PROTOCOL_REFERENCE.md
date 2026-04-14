# Pro DJ Link Protocol Reference
Complete Packet Structure Documentation
Source: https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html

## Protocol Foundation

The protocol used by Pioneer professional DJ equipment to communicate and coordinate performances enables synchronization of software like light shows and sequencers through network monitoring.

By creating a "virtual CDJ" that sends appropriate packets to the network, other devices can be induced to send packets containing detailed information about their state.

### Header Structure
All DJ Link packets begin with a consistent **10-byte header**: `51 73 70 74 31 57 6d 4a 4f 4c`

This is followed by a **type byte** that (combined with the port on which it was received) identifies the packet's function.

---

## Port 50000: Device Announcement & Channel Assignment

Packets sent to port 50000 handle network device discovery and channel (device number) negotiation.

| Type | Purpose |
|------|---------|
| `00` | First-stage channel number claim (mixers & CDJs) |
| `01` | Mixer assignment intention - sent by mixers to devices on channel-specific ports |
| `02` | Second-stage channel number claim (mixers & CDJs) |
| `03` | Mixer channel assignment - sent by mixers to devices on channel-specific ports |
| `04` | Final-stage channel number claim (mixers & CDJs) |
| `05` | Mixer assignment finished - sent by mixers to devices on channel-specific ports |
| `06` | Device keep-alive signal (still present on network) |
| `08` | Channel conflict notification - sent when a device sees another claiming the same channel |
| `0a` | Initial device announcement (mixers & CDJs) |

---

## Port 50001: Beat Synchronization & Mixer Integration

Packets sent to port 50001 manage beat synchronization (the foundational protocol element) and mixer features like Fader Start and Channels On Air.

| Type | Purpose |
|------|---------|
| `02` | Fader Start |
| `03` | Channels On Air |
| `0b` | Absolute Position |
| `26` | Master Handoff Request - tempo master negotiation |
| `27` | Master Handoff Response - tempo master acceptance |
| `28` | Beat packet - synchronization timing |
| `2a` | Sync Control |

---

## Port 50002: Device Status & Media Control

Packets sent to port 50002 provide detailed device status (crucial for tracking what track is playing, tempo, playback position) and information about mounted media. Also support remote-control features like track loading.

| Type | Purpose |
|------|---------|
| `05` | Media Query - request information about mounted media |
| `06` | Media Response - detailed media slot information |
| `0a` | CDJ Status - device playback and state information |
| `19` | Load Track Command - instruct player to load a track |
| `1a` | Load Track Acknowledgment - confirmation of track load |
| `29` | Mixer Status - mixer operational state |
| `34` | Load Settings Command - load mixer/player settings |

---

## Port 50004: Touch Audio Data

Packets sent to port 50004 provide touch audio data transmission between compatible devices.

| Type | Purpose |
|------|---------|
| `1e` | Audio Data - audio stream transmission |
| `1f` | Audio Handover - audio routing control |
| `20` | Audio Timing - audio synchronization timing |

---

## CDJ Status Packet Structure (Port 50002, Type `0a`)

### Packet Sizes by Device Type
- **Nexus players**: 0xd4 (212 bytes)
- **Older players**: 0xd0 (208 bytes) - without current beat number
- **Newer firmware & Nexus 2**: 0x11c or 0x124 bytes
- **XDJ-1000**: 0x11b (283 bytes)
- **CDJ-3000**: 0x200 (512 bytes)

### Status Frequency
- Sent roughly every 200ms
- More frequent updates during jog wheel manipulation on newer players

### Packet Structure Details

**Header:**
- Bytes 0-9: Fixed header `51 73 70 74 31 57 6d 4a 4f 4c`
- Byte 10: Packet type `0a` (CDJ Status)
- Bytes 11-12: Padding/reserved

**Device Identification:**
- Various bytes encode device number, status flags, playing/cued state

**Playback Information:**
- Current beat number (Nexus+)
- BPM (Beats Per Minute) - tempo information
- Playback position in track
- Play state (playing, paused, cued, etc.)

**Track Information:**
- Track metadata references
- Cue point information
- Hot cue indicators

---

## Mixer Status Packet Structure (Port 50002, Type `29`)

Provides operational state of mixer and channel information including:
- Fader positions
- Channel levels
- EQ states
- Crossfader position
- Effects states

---

## Beat Packet Structure (Port 50001, Type `28`)

Essential for tempo synchronization:
- Current beat number
- BPM value
- Timing information for beat alignment
- Source device identification

---

## Media Query (Port 50002, Type `05`) & Media Response (Type `06`)

### Media Query Structure
Request sent to query information about mounted media (USB or SD card)
- Media slot designation (USB/SD)
- Query flags

### Media Response Structure
Detailed response containing:
- Total tracks on media
- Media formatting information
- Rekordbox database availability
- Media status flags

---

## Startup & Channel Assignment Packets

### Stage 1 Claim (Type `00`)
Initial channel number claim sent during startup
- Device MAC address
- Device type identifier
- Requested channel number
- Device name

### Stage 2 Claim (Type `02`)
Second-stage claim confirming channel availability

### Final Claim (Type `04`)
Final confirmation of assigned channel

### Assignment Finished (Type `05`)
Mixer confirmation that all assignments complete

### Keep-Alive (Type `06`)
Periodic broadcast to maintain network presence
- Device MAC and IP
- Current device number
- Device status flags
- Equipment model/type

---

## Sync & Tempo Master Packets

### Master Handoff Request (Type `26`)
CDJ requesting to become tempo master
- Current BPM
- Device number
- Sync status

### Master Handoff Response (Type `27`)
Response to handoff request
- Acceptance/rejection indicator
- New master device number

### Sync Control (Type `2a`)
Ongoing sync control commands
- Sync mode flags
- Tempo adjustment commands

---

## Mixer Integration Packets

### Fader Start (Type `02`)
Transmitted when mixer crossfader reaches play threshold
- Channel identifier
- Fader state information
- Trigger flags

### Channels On Air (Type `03`)
Status of which channels are currently routed to output
- Channel bit flags
- Master volume level
- Output routing information

---

## Load Track Command (Type `19`) & Response (Type `1a`)

### Load Track Command Structure
Instruction to load a specific track
- Device destination number
- Media slot (USB/SD)
- Track ID/index
- Options flags (cue, quantize, etc.)

### Load Track Acknowledgment Structure
Confirmation of track load
- Success/failure status
- Loaded track information
- Current player state

---

## Load Settings Command (Type `34`)

Settings upload packet for remote configuration
- Hot cue assignments
- Cue point information
- DJ-specific settings
- Memory slots

---

## Touch Audio Packets (Port 50004)

### Audio Data (Type `1e`)
Continuous audio stream data
- Audio sample data
- Timing synchronization
- Channel information

### Audio Handover (Type `1f`)
Audio routing control
- Source device identification
- Target device identification
- Audio routing flags

### Audio Timing (Type `20`)
Synchronization timing for audio streams
- Timing reference
- Synchronization offset
- Buffer status

---

## Implementation Notes

### Discovering Devices
Monitor broadcasts on port 50000 to detect connected devices and their channel assignments. Keep-alive packets are sent regularly to maintain presence.

### Creating a Virtual CDJ
Bind UDP socket to port 50002 on your network interface
Send keep-alive packets to port 50000 broadcast address
Use device number 07 or higher to avoid conflicts
Devices will send detailed status information back

### Beat Synchronization
Port 50001 is essential for beat-locked timing information
Beat packets contain timing data for audio/visual synchronization
Master handoff packets control which device is tempo master

### Track Metadata
Obtain via TCP connections after discovery (separate from UDP protocol)
Details available in Track Metadata documentation

---

## References & Tools

- **Wireshark Dissectors**: https://github.com/nudge/wireshark-prodj-dissectors
- **Beat Link**: Java library for Pro DJ Link interaction
- **Crate Digger**: Java library for USB/SD media database parsing
- **Dysentery**: Protocol analysis tool (Clojure)
- **prolink-go**: Go implementation
- **python-prodj-link**: Python implementation

---

## Supported Hardware (Known)

- CDJ-2000 series (Nexus)
- CDJ-2000NXS (Nexus 1)
- CDJ-2000NXS2 (Nexus 2)
- CDJ-3000 (latest CDJ generation)
- DJM series mixers (matching generation)
- XDJ-1000 (standalone player)
- Rekordbox (via Beat Link rekordbox-mode)
- Opus Quad (via lighting-mode analysis)

---

## Status

Documentation current as of Deep Symmetry analysis (updated regularly)
Protocol continues to evolve with new hardware releases
Community contributions welcome on GitHub/Zulip
