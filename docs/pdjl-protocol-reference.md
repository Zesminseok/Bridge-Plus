# Pro DJ Link Protocol Reference

Source: https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html

## Packet Header

All DJ Link packets start with: `51 73 70 74 31 57 6d 4a 4f 4c` ("Qspt1WmJOL")
Followed by type byte at offset 0x0a.

## Ports

| Port | Purpose |
|------|---------|
| 50000 | Device negotiation, keep-alive |
| 50001 | Sync, beat, mixer control |
| 50002 | Device status |
| 50004 | Touch audio |

---

## Port 50000 — Device Negotiation

| Type | Name |
|------|------|
| 0x00 | Initial channel claim |
| 0x01 | Mixer assignment intention |
| 0x02 | Second-stage channel claim |
| 0x03 | Mixer channel assignment |
| 0x04 | Final-stage claim |
| 0x05 | Assignment finished |
| 0x06 | Keep-alive |
| 0x08 | Channel conflict |
| 0x0a | Initial announcement |

### Keep-Alive (type 0x06, 0x36 bytes)
- 0x24: Device number (D)
- 0x25: Device type (0x01=CDJ, 0x02=mixer)
- 0x26-0x2b: MAC address
- 0x2c-0x2f: IP address
- 0x30: Peer device count

---

## Port 50001 — Sync/Mixer Control

| Type | Name |
|------|------|
| 0x02 | Fader Start |
| 0x03 | Channels On Air |
| 0x0b | Absolute Position (Precise Position) |
| 0x26 | Master Handoff Request |
| 0x27 | Master Handoff Response |
| 0x28 | Beat packet |
| 0x2a | Sync Control |

### Beat Packet (type 0x28, 60 bytes)
| Offset | Field | Notes |
|--------|-------|-------|
| 0x0b-0x1f | Device name | ASCII, null-padded |
| 0x20 | Subtype | 0x00 |
| 0x21 | Device Number (D) | Player# or 0x21 for mixer |
| 0x24-0x27 | nextBeat | ms until next beat |
| 0x28-0x2b | 2ndBeat | ms until 2nd beat |
| 0x2c-0x2f | nextBar | ms until next bar |
| 0x30-0x33 | 4thBeat | ms until 4th beat |
| 0x34-0x37 | 2ndBar | ms until 2nd bar |
| 0x38-0x3b | 8thBeat | ms until 8th beat |
| 0x54-0x57 | Pitch | 0x00100000=0%, 0x00200000=+100% |
| 0x5a-0x5b | BPM | ×100 (divide by 100 for decimal) |
| 0x5c | Beat within bar (Bb) | 1→2→3→4 cycle |

Note: 0xFFFFFFFF in timing = track ends before event.

### Absolute/Precise Position (type 0x0b)
Sent on port 50001 by CDJ-3000 with direct ms playback position.

---

## Port 50002 — Device Status

| Type | Name |
|------|------|
| 0x05 | Media Query |
| 0x06 | Media Response |
| 0x0a | CDJ Status |
| 0x19 | Load Track Command |
| 0x1a | Load Track Acknowledgment |
| 0x29 | Mixer Status |
| 0x34 | Load Settings Command |

### CDJ Status (type 0x0a)

Packet sizes: Nexus=0xd4, pre-Nexus=0xd0, NXS2=0x11c/0x124, XDJ-1000=0x11b, CDJ-3000=0x200

#### Header
| Offset | Field | Notes |
|--------|-------|-------|
| 0x00-0x19 | Device Name | ASCII, null-padded |
| 0x20 | Subtype | 0x03 for CDJs |
| 0x21 | Device Number (D) | Player 1-4 (1-6 for CDJ-3000) |
| 0x22-0x23 | Length Remaining | |

#### Track Info
| Offset | Field | Notes |
|--------|-------|-------|
| 0x27 | Activity (A) | 0x00=idle, 0x01=active |
| 0x28 | Source Device (Dr) | Player# owning the media |
| 0x29 | Slot (Sr) | 0x01=CD, 0x02=SD, 0x03=USB, 0x04=rekordbox |
| 0x2a | Track Type (Tr) | 0x01=rekordbox, 0x02=unanalyzed, 0x05=CD |
| 0x2c-0x2f | Rekordbox Track ID | 4 bytes |

#### Playback State
| Offset | Field | Values |
|--------|-------|--------|
| 0x7b | Play Mode (P1) | 0x00=none, 0x02=loading, 0x03=playing, 0x04=loop, 0x05=paused, 0x06=cued, 0x07=cue play, 0x08=cue scratch, 0x09=search, 0x11=end, 0x12=emergency loop |
| 0x8b | Play State (P2) | nexus: 0x7a=play/0x7e=stop; nxs2: 0xfa/0xfe |

#### Status Flags (byte 0x89, bit field)
| Bit | Flag |
|-----|------|
| 6 | Play (1=playing) |
| 5 | Master |
| 4 | Sync enabled |
| 3 | On-Air |

#### BPM / Pitch
| Offset | Field | Notes |
|--------|-------|-------|
| 0x92-0x93 | Track BPM | ÷100 for decimal |
| 0x8c-0x8f | Pitch1 (effective) | 0x100000=0%, 0x200000=+100% |
| 0x98-0x9b | Pitch2 (fader) | Local pitch fader position |

**Effective BPM = (BPM/100) × (Pitch1 / 0x100000)**

#### Beat / Position
| Offset | Field | Notes |
|--------|-------|-------|
| 0xa0-0xa3 | Beat Counter | From track start; 0xFFFFFFFF if no RB track |
| 0xa6 | Beat Within Bar (Bb) | 1-4 cycle; 0x00 if no RB track |
| 0xa4-0xa5 | Cue Countdown | 0x01ff=no cue ahead, decrements per beat to 0x0000 |

#### Loop Info (CDJ-3000, offset 0x1B0+)
| Offset | Field | Notes |
|--------|-------|-------|
| 0x1b6-0x1b9 | Loop Start | ms × 65536 (divide by 1000) |
| 0x1be-0x1c1 | Loop End | ms × 65536 (divide by 1000) |
| 0x1c8-0x1c9 | Loop Beat Count | Whole beats in active loop |
| 0xba | Emergency Loop flag | 0x01=loop active |

#### Key Detection (CDJ-3000)
| Offset | Field | Notes |
|--------|-------|-------|
| 0x15c | Note | 0x00-0x0b (C through B) |
| 0x15d | Mode | 0x00=minor, 0x01=major |
| 0x15e | Accidental | 0x00=natural, 0x01=sharp, 0xff=flat |

#### Settings Blocks (offset 0xd0+)
Header: `0x12 0x34 0x56 0x78`
- 0x0a: Waveform color (0x01=blue, 0x03=RGB, 0x04=3-band)
- 0x0d: Waveform position (0x01=center, 0x02=left)

### Mixer Status (type 0x29, 0x38 bytes)
- Subtype 0x00
- 0x27: Status flag (0xf0=tempo master, 0xd0=not)
- 0x37: Beat within bar (not synced with master)

---

## Startup Sequence

1. Initial Announcement (type 0x0a, every ~300ms, port 50000)
2. First-Stage Claim (type 0x00, 3 packets)
3. Second-Stage Claim (type 0x02, 3 packets, includes IP/MAC/device#)
4. Final-Stage Claim (type 0x04, 3 packets)
5. Keep-Alive (type 0x06, every ~1.5s)

CDJ-3000 uses slightly different packet sizes and byte 0x21=0x04 (vs 0x02).

### CDJ-3000 Keep-Alive
- Byte 0x35 must be 0x64 (incorrect values cause network kicks)
- Supports device numbers 5-6

---

## Mixer Integration (Port 50001)

### Fader Start (type 0x02)
- Port 50001, broadcast or direct to player
- Command bytes C1-C4 (one per channel):
  - 0x00: Start playback if at cue point
  - 0x01: Stop playback, return to cue
  - 0x02: Maintain current state
- NOT supported on XDJ-XZ and CDJ-3000

### Channels On Air (type 0x03)
- Port 50001, broadcast
- 4-channel: subtype 0x00, lenr=0x0009, flags F1-F4
- 6-channel: subtype 0x03, lenr=0x0011, flags F1-F6
- Flag values: 0x00=off-air, 0x01=on-air

---

## DJM-900NXS2 Type 0x39 (Mixer Status, 248 bytes, Port 50002)

Decoded via pcapng analysis (not in official docs):
- 4 channels × 24 bytes starting at offset 0x24
- CH_STRIDE = 0x18 (24 bytes per channel)
- byte+3: Channel fader (0-255)
- byte+11: On-air level (0-255)

---

## References
- https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html
- https://djl-analysis.deepsymmetry.org/djl-analysis/vcdj.html
- https://djl-analysis.deepsymmetry.org/djl-analysis/beats.html
- https://djl-analysis.deepsymmetry.org/djl-analysis/mixer_integration.html
- https://djl-analysis.deepsymmetry.org/djl-analysis/startup.html
