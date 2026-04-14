# Pro DJ Link Protocol - Complete Reference Index

Complete documentation for the Pioneer Pro DJ Link network protocol used by CDJ, DJM mixers, and Rekordbox.

**Source**: https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html

---

## Document Overview

This comprehensive reference consists of three detailed documents:

### 1. PRO_DJ_LINK_PROTOCOL_REFERENCE.md (8.8 KB)
**Overview and Packet Type Summary**

High-level reference covering:
- Protocol foundation and network basics
- All packet types organized by port (50000, 50001, 50002, 50004)
- Purpose and function of each packet type
- Supported hardware list
- Quick reference tables for each port

**Best for**: Quick lookups, understanding protocol structure, choosing packet type for your use case

### 2. PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md (17 KB)
**Detailed Byte-Level Structure**

Complete technical reference with:
- Exact byte offsets for every field in each packet type
- Field lengths and data types
- Decoding instructions (BPM scaling, EQ conversion, timestamp formats)
- Device identifiers and type codes
- Data encoding formats (big-endian, multi-byte handling)

**Best for**: Implementation, debugging, reverse engineering, protocol compliance

### 3. PRO_DJ_LINK_IMPLEMENTATION.md (13 KB)
**Practical Code Examples and Integration**

Working examples and patterns including:
- UDP socket setup and network configuration
- Python code examples for parsing all major packet types
- Creating/broadcasting virtual CDJ packets
- Beat synchronization and tempo following
- Track change detection
- Error handling and validation
- Testing tools and debugging utilities

**Best for**: Development, integration, testing, troubleshooting

---

## Quick Navigation

### By Use Case

**I want to understand the protocol:**
1. Start with PRO_DJ_LINK_PROTOCOL_REFERENCE.md (sections: Protocol Foundation, Port 50000-50004)
2. Review PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md for detail depth

**I'm implementing a virtual CDJ:**
1. Read PRO_DJ_LINK_IMPLEMENTATION.md (sections: Virtual CDJ Setup, Creating Packets)
2. Reference PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md for packet structures
3. Use PRO_DJ_LINK_PROTOCOL_REFERENCE.md as quick reference

**I'm debugging packet issues:**
1. Use PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md for exact field positions
2. Check parsing examples in PRO_DJ_LINK_IMPLEMENTATION.md
3. Use hex dump utility for inspection

**I need track metadata:**
1. See PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md (Load Track Command Type 0x19)
2. Check PRO_DJ_LINK_IMPLEMENTATION.md (section: Connecting to Track Metadata)
3. Reference: https://djl-analysis.deepsymmetry.org/djl-analysis/track_metadata.html

**I'm synchronizing audio/lighting:**
1. Study PRO_DJ_LINK_PROTOCOL_REFERENCE.md (Port 50001: Beat Synchronization)
2. Review beat packet parsing in PRO_DJ_LINK_IMPLEMENTATION.md
3. See tempo following pattern implementation

---

## Key Sections by Topic

### Network Setup
- Protocol Reference: "Protocol Foundation" section
- Implementation: "Virtual CDJ Setup" section
- Byte Offsets: "Universal Packet Header" section

### Device Discovery
- Protocol Reference: "Port 50000: Device Announcement & Channel Assignment"
- Implementation: "Discovering Devices" subsection
- Byte Offsets: Keep-Alive Packet (Type 06) section

### Beat Synchronization
- Protocol Reference: "Port 50001: Beat Synchronization & Mixer Integration"
- Implementation: "Parsing Beat Packet" and "Tempo Following" sections
- Byte Offsets: Beat Packet Structure (Type 0x28) section

### Device Status
- Protocol Reference: "Port 50002: Device Status & Media Control"
- Implementation: "Parsing CDJ Status" section
- Byte Offsets: CDJ Status Packet Structure (Type 0x0a) section

### Mixer Control
- Protocol Reference: "Mixer Integration Packets"
- Implementation: "Parsing Mixer Status" section
- Byte Offsets: Mixer Status Packet Structure (Type 0x29) section

### Track Loading
- Protocol Reference: "Load Track Command" subsection
- Implementation: "Creating Load Track Packet" (use as model)
- Byte Offsets: Load Track Command (Type 0x19) and Response (Type 0x1a) sections

### Tempo Master
- Protocol Reference: "Sync & Tempo Master Packets"
- Implementation: "Master Status" and "Tempo Master Negotiation" sections
- Byte Offsets: Master Handoff Request/Response sections

---

## Packet Type Quick Reference

### Port 50000 (Device Discovery)
| Type | Function | Ref Doc | Byte Offset |
|------|----------|---------|------------|
| 0x00 | First-stage channel claim | Protocol | Byte Offsets (Common Fields) |
| 0x01 | Mixer assignment intention | Protocol | Byte Offsets (Common Fields) |
| 0x02 | Second-stage channel claim | Protocol | Byte Offsets (Common Fields) |
| 0x03 | Mixer channel assignment | Protocol | Byte Offsets (Common Fields) |
| 0x04 | Final-stage channel claim | Protocol | Byte Offsets (Common Fields) |
| 0x05 | Mixer assignment finished | Protocol | Byte Offsets (Common Fields) |
| 0x06 | Keep-alive | Implementation | Byte Offsets (Keep-Alive) |
| 0x08 | Channel conflict | Protocol | Byte Offsets (Conflict) |
| 0x0a | Initial announcement | Protocol | Byte Offsets (Common Fields) |

### Port 50001 (Beat Sync)
| Type | Function | Ref Doc | Byte Offset |
|------|----------|---------|------------|
| 0x02 | Fader Start | Protocol | Byte Offsets (Fader Start) |
| 0x03 | Channels On Air | Protocol | Byte Offsets (Channels On Air) |
| 0x0b | Absolute Position | Protocol | Byte Offsets (Absolute Position) |
| 0x26 | Master request | Implementation | Byte Offsets (Master Handoff) |
| 0x27 | Master response | Implementation | Byte Offsets (Master Handoff) |
| 0x28 | Beat | Implementation | Byte Offsets (Beat Packet) |
| 0x2a | Sync Control | Protocol | Byte Offsets (Sync Control) |

### Port 50002 (Status & Control)
| Type | Function | Ref Doc | Byte Offset |
|------|----------|---------|------------|
| 0x05 | Media Query | Protocol | Byte Offsets (Media Query) |
| 0x06 | Media Response | Protocol | Byte Offsets (Media Response) |
| 0x0a | CDJ Status | Implementation | Byte Offsets (CDJ Status) |
| 0x19 | Load Track | Protocol | Byte Offsets (Load Track) |
| 0x1a | Load Track ACK | Protocol | Byte Offsets (Load Track ACK) |
| 0x29 | Mixer Status | Implementation | Byte Offsets (Mixer Status) |
| 0x34 | Load Settings | Protocol | Byte Offsets (Load Settings) |

### Port 50004 (Touch Audio)
| Type | Function | Ref Doc | Byte Offset |
|------|----------|---------|------------|
| 0x1e | Audio Data | Protocol | Byte Offsets (Audio Data) |
| 0x1f | Audio Handover | Protocol | Byte Offsets (Audio Handover) |
| 0x20 | Audio Timing | Protocol | Byte Offsets (Audio Timing) |

---

## Common Data Formats

### BPM Encoding
- **Storage**: Unsigned 16-bit big-endian integer = BPM × 100
- **Example**: 120 BPM = 0x1770 (5488 decimal)
- **Range**: 30-300 BPM typical (0x0BB8 to 0x29A0)
- **Locations**: 
  - Beat packet: bytes 12-13
  - CDJ status: bytes 15-16
  - Mixer status: bytes 35-36
  - Master request: byte 14 (8-bit integer only)

### Position/Timestamp Encoding
- **Milliseconds**: Unsigned 32-bit big-endian (bytes)
- **Beat count**: Unsigned 32-bit big-endian (beats)
- **Track position**: milliseconds (CDJ status bytes 19-22)
- **Beat position**: beats (CDJ status bytes 23-26)

### Device Numbers
- `0x01` = CDJ Deck 1
- `0x02` = CDJ Deck 2
- `0x03` = CDJ Deck 3
- `0x04` = CDJ Deck 4 or Sampler
- `0x07` = Virtual CDJ (recommended for software)
- `0x21` (33) = Mixer/DJM
- `0x00` = Broadcast/Unassigned

### Device Types
- `0x01` = CDJ
- `0x03` = Mixer
- `0x04` = Rekordbox
- `0x05` = XDJ-AZ

### Media Slots
- `0x01` = USB media
- `0x02` = SD Card media
- `0x03` = Rekordbox database

---

## Implementation Checklist

### Basic Virtual CDJ
- [ ] Create UDP sockets on your network interface
- [ ] Send keep-alive packets to port 50000 (Type 0x06) every 200-500ms
- [ ] Listen on port 50002 for incoming status packets
- [ ] Parse CDJ status packets (Type 0x0a)
- [ ] Parse mixer status packets (Type 0x29)
- [ ] Extract BPM, device state, and track position

### Beat Synchronization
- [ ] Listen on port 50001 for beat packets (Type 0x28)
- [ ] Extract BPM and beat number from beat packets
- [ ] Implement beat counting/timing logic
- [ ] Optional: Implement tempo following with smoothing

### Tempo Master Negotiation
- [ ] Send Master Handoff Request (Type 0x26) when needed
- [ ] Parse Master Handoff Response (Type 0x27)
- [ ] Handle master status changes (mixer vs. CDJ)

### Track Detection
- [ ] Extract track ID from CDJ status packets
- [ ] Detect track changes and trigger callbacks
- [ ] Optional: Query metadata via TCP connection

### Error Handling
- [ ] Validate packet headers (magic bytes)
- [ ] Check packet type validity
- [ ] Handle variable packet lengths
- [ ] Implement timeout detection
- [ ] Add exception handling for malformed packets

---

## Supported Hardware (Verified)

**Pioneer CDJ Series:**
- CDJ-2000 (original)
- CDJ-2000NXS (Nexus)
- CDJ-2000NXS2 (Nexus 2)
- CDJ-3000 (latest)

**Pioneer Mixer Series:**
- DJM-900 (Nexus era)
- DJM-900NXS
- DJM-900NXS2
- DJM-750
- Other DJM models (compatible)

**Pioneer Players:**
- XDJ-1000
- XDJ-700
- XDJ-AZ

**Rekordbox:**
- Rekordbox DJ (via Beat Link library in rekordbox-mode)
- Rekordbox Performance
- Opus Quad (limited support via lighting mode analysis)

---

## Testing & Validation

### Tools
- **Wireshark + Dissectors**: https://github.com/nudge/wireshark-prodj-dissectors
- **tcpdump**: Capture raw network traffic
- **Beat Link**: Test implementation against known working library
- **Hex dump utility**: Debug packet content (see Implementation guide)

### Test Scenarios
1. Device discovery: Verify keep-alive reception
2. Beat synchronization: Check beat packet timing
3. Status updates: Validate CDJ state changes
4. Track changes: Confirm track ID updates
5. Tempo changes: Monitor BPM value changes
6. Master negotiation: Test handoff behavior

---

## External Resources

### Official Documentation
- **Deep Symmetry DJ Link Analysis**: https://djl-analysis.deepsymmetry.org/
- **Wireshark Dissectors**: https://github.com/nudge/wireshark-prodj-dissectors

### Reference Implementations
- **Beat Link** (Java): https://github.com/Deep-Symmetry/beat-link
- **prolink-go** (Go): https://github.com/EvanPurkhiser/prolink-go
- **python-prodj-link** (Python): https://github.com/flesniak/python-prodj-link

### Related Projects
- **Dysentery**: Protocol analysis tool (https://github.com/Deep-Symmetry/dysentery)
- **Crate Digger**: USB/SD media database parser (https://github.com/Deep-Symmetry/crate-digger)
- **Beat Link Trigger**: Beat-synchronous event triggering (https://github.com/Deep-Symmetry/beat-link-trigger)

---

## Document Maintenance

Last Updated: 2026-04-13
Source Version: Deep Symmetry DJ Link Analysis (main branch)
Protocol Coverage: DJ Link packets for CDJ-3000, NXS2, and earlier hardware

This documentation covers the UDP-based DJ Link protocol used for device discovery, beat synchronization, and status monitoring. TCP-based metadata queries and database connections are referenced but detailed documentation can be found in the Deep Symmetry Track Metadata pages.

---

## Quick Start Commands

### Capture DJ Link traffic
```bash
sudo tcpdump -i en0 'udp port 50000 or udp port 50001 or udp port 50002 or udp port 50004' -w djlink.pcap
```

### Parse with sample Python code
See PRO_DJ_LINK_IMPLEMENTATION.md for parsing examples

### Test virtual CDJ
See "Virtual CDJ Setup" in PRO_DJ_LINK_IMPLEMENTATION.md
