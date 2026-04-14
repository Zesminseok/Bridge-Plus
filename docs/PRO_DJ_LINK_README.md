# Pro DJ Link Protocol - Complete Documentation Set

Complete reference documentation for the Pioneer Pro DJ Link network protocol used by professional DJ equipment (CDJ, DJM, Rekordbox).

## Files in This Collection

### 1. **PRO_DJ_LINK_INDEX.md** - START HERE
Navigation guide and quick reference
- Document index and how to use this collection
- Quick navigation by use case
- Packet type reference tables
- Implementation checklist
- Hardware compatibility list

### 2. **PRO_DJ_LINK_PROTOCOL_REFERENCE.md** - High-Level Overview
Protocol fundamentals and packet types
- Protocol foundation and packet structure
- All 26 packet types organized by port
- Port 50000: Device discovery (9 types)
- Port 50001: Beat synchronization (7 types)
- Port 50002: Device status & control (7 types)
- Port 50004: Touch audio (3 types)
- Supported hardware reference

### 3. **PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md** - Technical Reference
Detailed byte-level packet structure
- Exact byte offsets for every field
- Field lengths and data types
- All 26 packet types with complete structure
- BPM, EQ, and timestamp encoding
- Device identifiers and codes
- Data encoding formats (big-endian, multi-byte)

### 4. **PRO_DJ_LINK_IMPLEMENTATION.md** - Code Examples
Practical implementation and integration
- Virtual CDJ setup guide
- Python parsing code for all major packets
- Packet creation and serialization
- Working examples:
  - Beat synchronization
  - Track change detection
  - Tempo following
  - Master negotiation
  - Error handling
- Testing utilities and debugging

## Quick Start

### Understanding the Protocol
1. Read: PRO_DJ_LINK_PROTOCOL_REFERENCE.md
2. Reference: PRO_DJ_LINK_INDEX.md (packet tables)

### Building Implementation
1. Follow: PRO_DJ_LINK_IMPLEMENTATION.md (Virtual CDJ Setup)
2. Reference: PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md (packet structures)
3. Test: Use hex dump utilities and Wireshark

### Debugging Issues
1. Check: PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md (exact offsets)
2. Review: PRO_DJ_LINK_IMPLEMENTATION.md (parsing code)
3. Test: Use packet validation and dump utilities

## Key Facts

### Network Basics
- **Ports**: 50000 (discovery), 50001 (beat), 50002 (status), 50004 (audio)
- **Transport**: UDP (connectionless)
- **Broadcast**: 255.255.255.255
- **Header**: Fixed 10 bytes: `51 73 70 74 31 57 6d 4a 4f 4c`
- **Update Frequency**: ~200ms (varies by packet type)

### Device Numbers
- `0x01-0x04`: CDJ Decks 1-4
- `0x07`: Virtual CDJ (recommended for software)
- `0x21`: Mixer/DJM
- `0x00`: Broadcast/Unassigned

### BPM Encoding
- **Format**: Unsigned 16-bit big-endian = BPM × 100
- **Example**: 120 BPM = `0x1770` (5488 decimal)
- **Range**: 30-300 BPM typical

### Packet Sizes
- **Nexus 1**: 212 bytes (0xd4)
- **Nexus 2**: 276-292 bytes (0x11c-0x124)
- **XDJ-1000**: 283 bytes (0x11b)
- **CDJ-3000**: 512 bytes (0x200)

## Protocol Summary

### Port 50000 - Device Discovery
Handles device presence on network, channel assignment, and conflicts.
Types: 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x08, 0x0a

### Port 50001 - Beat Synchronization
Broadcasts beat information, tempo data, and mixer events.
Types: 0x02 (fader), 0x03 (channels), 0x0b (position), 0x26 (master req), 0x27 (master res), 0x28 (beat), 0x2a (sync)

### Port 50002 - Device Status
Device state, playback position, media information, and remote control.
Types: 0x05 (media query), 0x06 (media resp), 0x0a (CDJ status), 0x19 (load), 0x1a (load ack), 0x29 (mixer), 0x34 (settings)

### Port 50004 - Touch Audio
Direct audio stream transmission between devices.
Types: 0x1e (audio), 0x1f (handover), 0x20 (timing)

## Supported Equipment

### CDJs
- CDJ-2000 (original Nexus)
- CDJ-2000NXS (Nexus 1)
- CDJ-2000NXS2 (Nexus 2)
- CDJ-3000 (latest generation)

### Mixers
- DJM-900, DJM-900NXS, DJM-900NXS2
- DJM-750 and other DJM series

### Players
- XDJ-1000, XDJ-700, XDJ-AZ

### Software
- Rekordbox DJ, Performance
- Beat Link library (Java)
- prolink-go (Go)
- python-prodj-link (Python)

## Data Formats Reference

### All multi-byte values: Big-endian (network byte order)

### BPM
- Bytes: 2 unsigned big-endian
- Calculation: value ÷ 100 = BPM
- Example: 0x1388 = 5000 ÷ 100 = 50 BPM

### Position/Timestamps
- Bytes: 4 unsigned big-endian
- Unit: Milliseconds or beat count
- Range: 0 to 4,294,967,295 (~18+ hours)

### EQ Values
- Bytes: 1 signed
- Range: -12 dB to +12 dB
- Neutral: 0x40
- Calculation: (value - 0x40) × 12 ÷ 0x40 = dB

### Fader Positions
- Bytes: 1 unsigned
- Range: 0x00 (closed) to 0x7F (open)
- Linear interpolation between values

## Testing & Tools

### Capture Traffic
```bash
sudo tcpdump -i en0 'udp port 50000 or 50001 or 50002 or 50004' -w djlink.pcap
```

### Analyze with Wireshark
Install: https://github.com/nudge/wireshark-prodj-dissectors

### Reference Implementations
- Beat Link: https://github.com/Deep-Symmetry/beat-link
- prolink-go: https://github.com/EvanPurkhiser/prolink-go
- python-prodj-link: https://github.com/flesniak/python-prodj-link

## External Resources

- **Deep Symmetry DJ Link Analysis**: https://djl-analysis.deepsymmetry.org/
- **Wireshark Dissectors**: https://github.com/nudge/wireshark-prodj-dissectors
- **Dysentery**: Protocol analysis tool (https://github.com/Deep-Symmetry/dysentery)
- **Crate Digger**: USB/SD media parser (https://github.com/Deep-Symmetry/crate-digger)

## Document Statistics

| Document | Size | Lines | Content |
|----------|------|-------|---------|
| PRO_DJ_LINK_INDEX.md | 11 KB | 400+ | Navigation, checklists, quick ref |
| PRO_DJ_LINK_PROTOCOL_REFERENCE.md | 8.8 KB | 315 | High-level overview & packet types |
| PRO_DJ_LINK_PACKET_BYTE_OFFSETS.md | 17 KB | 442 | Byte-level technical detail |
| PRO_DJ_LINK_IMPLEMENTATION.md | 13 KB | 532 | Code examples & patterns |
| **Total** | **50 KB** | **1,689** | **Complete protocol reference** |

## Usage Tips

### By Role
- **Protocol Designer**: Start with PROTOCOL_REFERENCE.md
- **Developer**: Use IMPLEMENTATION.md + BYTE_OFFSETS.md
- **Debugger**: Use BYTE_OFFSETS.md + hex dump utility
- **Tester**: Use INDEX.md checklist + testing tools

### By Task
- Quick lookup: INDEX.md packet tables
- Understanding: PROTOCOL_REFERENCE.md
- Implementing: IMPLEMENTATION.md examples
- Debugging: BYTE_OFFSETS.md + IMPLEMENTATION.md utilities
- Validating: INDEX.md checklist

## Contributing

This documentation is based on the Deep Symmetry DJ Link Ecosystem Analysis project, which welcomes community contributions:
- GitHub: https://github.com/Deep-Symmetry/dysentery
- Community Chat: https://deep-symmetry.zulipchat.com/

## License

This documentation references and builds upon the Deep Symmetry analysis (licensed under MPL-2.0). Created as reference material for Pro DJ Link protocol integration.

---

**Last Updated**: 2026-04-13
**Protocol Source**: https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html
**Coverage**: CDJ-3000, NXS2, and all Pro DJ Link compatible devices
