# Pro DJ Link Protocol - Detailed Byte Offset Reference
Complete Packet Structure with Field Positions
Source: https://djl-analysis.deepsymmetry.org/djl-analysis/

## Universal Packet Header (All Ports)

All DJ Link packets begin with this consistent structure:

```
Byte Offset | Length | Content
0-9         | 10     | Fixed Header: 51 73 70 74 31 57 6d 4a 4f 4c
10          | 1      | Packet Type (identifies message type)
11-12       | 2      | Padding/Reserved
```

The header spells out "QsptMmjOl" in ASCII (magic bytes for packet identification).

---

## Port 50000: Device Announcement & Channel Assignment

### Common Fields for Port 50000 Packets (Types 00, 02, 04)

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 00, 02, or 04
11-12       | Padding              | 2      | 00 00
13-18       | MAC Address          | 6      | Device network address
19-22       | IP Address           | 4      | Device IP (network byte order)
23          | Device Number        | 1      | Channel/Device ID (1-4)
24-25       | Name Offset          | 2      | Pointer to device name
26+         | Device Name          | var    | Null-terminated, padded with 00
```

### Keep-Alive Packet (Type 06)

Used to maintain network presence every few seconds.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 06
11-12       | Padding              | 2      | 00 00
13-18       | MAC Address          | 6      | Sender's MAC
19-22       | IP Address           | 4      | Sender's IP
23          | Device Number        | 1      | Assigned channel (1-4)
24-25       | Padding              | 2      | 00 00
26          | Device Type          | 1      | 01=CDJ, 03=Mixer, 04=Rekordbox
27-42       | Device Name          | 16     | Null-terminated name (e.g., "CDJ-2000NXS")
43-58       | Model Name           | 16     | Equipment model identifier
```

### Channel Conflict Packet (Type 08)

Sent when device detects channel number collision.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 08
11-12       | Padding              | 2      | 00 00
13-18       | MAC Address          | 6      | Conflicting device MAC
19-22       | IP Address           | 4      | Conflicting device IP
23          | Device Number        | 1      | Claimed channel in conflict
```

---

## Port 50001: Beat Synchronization

### Beat Packet (Type 28)

Essential for master tempo synchronization.

```
Byte Offset | Field Name           | Length | Notes / Range
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 28 (beat)
11          | Half-Beat            | 1      | 00-01 (distinguishes beat/half-beat)
12-13       | BPM (scaled)         | 2      | Integer: BPM * 100 (big-endian)
14          | Beat Number          | 1      | 1-4 (beat position in measure)
15-16       | Padding              | 2      | 00 00
17          | Device Number        | 1      | Source device (1-4)
18-27       | Padding              | 10     | Reserved
```

**BPM Calculation**: Divide byte offset 12-13 value by 100 to get actual BPM.
Example: 0x1388 = 5000 decimal = 50.00 BPM

### Master Handoff Request (Type 26)

CDJ signals intent to become tempo master.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 26
11-12       | Padding              | 2      | 00 00
13          | Device Number        | 1      | Requesting device (1-4)
14          | Current BPM          | 1      | Integer BPM value
15-27       | Padding              | 13     | Reserved
```

### Master Handoff Response (Type 27)

Acceptance/rejection of tempo master role transfer.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 27
11-12       | Padding              | 2      | 00 00
13          | New Master Device    | 1      | Device taking master role (1-4)
14-27       | Padding              | 14     | Reserved
```

### Fader Start (Type 02)

Crossfader position for play triggering.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 02
11-12       | Padding              | 2      | 00 00
13          | Channel              | 1      | 1-3 (mixer channels)
14          | Fader Position       | 1      | 0-7F (crossfader value)
15-27       | Padding              | 13     | Reserved
```

### Channels On Air (Type 03)

Which mixer channels are currently routing to output.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 03
11-12       | Padding              | 2      | 00 00
13          | Channel Flags        | 1      | Bit 0=Ch1, Bit 1=Ch2, Bit 2=Ch3 on air
14-27       | Padding              | 14     | Reserved
```

### Absolute Position (Type 0b)

Beat/bar position synchronization reference.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 0b
11-12       | Padding              | 2      | 00 00
13-16       | Position             | 4      | Elapsed beats since track load (big-endian)
17          | Device Number        | 1      | Source device
18-27       | Padding              | 10     | Reserved
```

---

## Port 50002: Device Status & Media

### CDJ Status Packet (Type 0a)

Comprehensive device status - most important packet type.

**Size**: Varies by device
- Nexus 1/Nexus 2: 0xd4 (212 bytes)
- Older CDJ: 0xd0 (208 bytes)
- XDJ-1000: 0x11b (283 bytes)
- CDJ-3000: 0x200 (512 bytes)

**Generic Structure** (common across generations):

```
Byte Offset | Field Name                | Length | Notes
0-9         | Header                    | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type               | 1      | 0a (CDJ Status)
11          | Padding                   | 1      | 00
12          | Device Number             | 1      | Channel ID (1-4)
13          | Device State              | 1      | 00=off, 01=on, other=transitioning
14          | Play State                | 1      | 00=pause, 01=playing, 02=cueing
15          | BPM (scaled)              | 2      | BPM * 100 (big-endian uint16)
17-18       | Speed/Pitch               | 2      | Relative speed to target BPM
19-22       | Track Position (ms)       | 4      | Milliseconds into track (big-endian uint32)
23-26       | Track Position (beats)    | 4      | Beat number in track (big-endian uint32)
27-30       | Track ID                  | 4      | Rekordbox track ID (big-endian uint32)
31-34       | Album ID                  | 4      | Rekordbox album ID (big-endian uint32)
35-50       | Device Name               | 16     | "CDJ-3000", "DJM-900", etc. (null-padded)
51+         | Additional Status Fields  | var    | Extended fields (varies by device)
```

**Additional Nexus Fields** (Offset 50+):

```
Byte Offset | Field Name                | Length | Notes
51-54       | Hot Cue 1 Position        | 4      | Milliseconds or 0xFFFFFFFF if not set
55-58       | Hot Cue 2 Position        | 4      | Milliseconds or 0xFFFFFFFF if not set
59-62       | Hot Cue 3 Position        | 4      | Milliseconds or 0xFFFFFFFF if not set
63-66       | Cue Point Position        | 4      | Main cue point in milliseconds
67-70       | Master/Sync Status        | 4      | Flags for sync mode, tempo master, etc.
71+         | Reserved/Extended Fields  | var    | Device-specific metadata
```

**CDJ-3000 Extended Fields** (0x200 byte packets):
- Beats since track load
- Beat counter reference
- Physical jog position
- Tempo adjustment range
- Hot cue additional fields (6 total on CDJ-3000)
- Extended metadata and status flags

### Mixer Status Packet (Type 29)

Mixer operational state.

**Size**: 0x38 (56 bytes)

```
Byte Offset | Field Name                | Length | Notes
0-9         | Header                    | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type               | 1      | 29 (mixer status)
11          | Padding                   | 1      | 00
12          | Device Number             | 1      | Always 33 (0x21) for mixer
13-14       | Padding                   | 2      | 00 00
15          | CH1 Fader Position        | 1      | 0-7F (closed to open)
16          | CH2 Fader Position        | 1      | 0-7F
17          | CH3 Fader Position        | 1      | 0-7F
18          | CH4 Fader Position        | 1      | 0-7F (MIC on DJM)
19          | Crossfader Position       | 1      | 0-7F (left to right)
20          | Master Level              | 1      | 0-7F (fader position)
21          | Master Headphone Level    | 1      | 0-7F
22          | Channel Select (PFL)      | 1      | Bit flags for headphone monitoring
23          | EQ CH1 (High)             | 1      | -12db to +12dB (scaled)
24          | EQ CH1 (Mid)              | 1      | -12db to +12dB (scaled)
25          | EQ CH1 (Low)              | 1      | -12db to +12dB (scaled)
26          | EQ CH2 (High)             | 1      | -12db to +12dB (scaled)
27          | EQ CH2 (Mid)              | 1      | -12db to +12dB (scaled)
28          | EQ CH2 (Low)              | 1      | -12db to +12dB (scaled)
29          | EQ CH3 (High)             | 1      | -12db to +12dB (scaled)
30          | EQ CH3 (Mid)              | 1      | -12db to +12dB (scaled)
31          | EQ CH3 (Low)              | 1      | -12db to +12dB (scaled)
32          | EQ CH4 (High)             | 1      | -12db to +12dB (scaled)
33          | EQ CH4 (Mid)              | 1      | -12db to +12dB (scaled)
34          | EQ CH4 (Low)              | 1      | -12db to +12dB (scaled)
35          | Master Tempo              | 2      | Master BPM * 100 (big-endian)
37-55       | Padding/Reserved          | 19     | Reserved for future use
```

**Fader Position Calculation**:
- Raw value 0x00 = fully closed (channel muted)
- Raw value 0x7F = fully open
- Linear interpolation between values

**EQ Scaling**:
- Raw 0x00 = -12 dB
- Raw 0x40 = 0 dB (neutral)
- Raw 0x7F = +12 dB
- Formula: (value - 0x40) * 12 / 0x40 in dB

### Media Query (Type 05)

Request for media/track list information.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 05
11-12       | Padding              | 2      | 00 00
13          | Requesting Device    | 1      | Device sending query (1-4)
14          | Media Slot           | 1      | 01=USB, 02=SD (location to query)
15-27       | Padding              | 13     | Reserved
```

### Media Response (Type 06)

Response to media query with available tracks.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 06
11-12       | Padding              | 2      | 00 00
13          | Device Number        | 1      | Responding device (1-4)
14          | Media Slot           | 1      | 01=USB, 02=SD (which slot)
15-18       | Total Tracks         | 4      | Number of tracks on media (big-endian)
19-22       | Rekordbox Offset     | 4      | Byte offset to Rekordbox DB (or 0)
23-26       | Oldest Update        | 4      | Timestamp of oldest track (big-endian)
27-30       | Media Status Flags   | 4      | Flags for media state
31-35       | Padding              | 5      | Reserved
```

### Load Track Command (Type 19)

Instruct a player to load a track.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 19
11-12       | Padding              | 2      | 00 00
13          | Target Device        | 1      | Device to load track (1-4)
14          | Media Slot           | 1      | 01=USB, 02=SD
15-18       | Track ID             | 4      | Rekordbox track ID (big-endian)
19-22       | Playlist ID          | 4      | Rekordbox playlist ID (big-endian)
23          | Options              | 1      | Bit flags (cue point, hot cues, etc.)
24-41       | Padding              | 18     | Reserved
```

### Load Track Acknowledgment (Type 1a)

Confirmation that track load was processed.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 1a
11-12       | Padding              | 2      | 00 00
13          | Device Number        | 1      | Device that loaded track (1-4)
14          | Result               | 1      | 00=success, 01=error
15-18       | Track ID Loaded      | 4      | ID of track now loaded (big-endian)
19-41       | Padding              | 23     | Reserved
```

### Load Settings Command (Type 34)

Upload settings (hot cues, memory, etc.) to player.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 34
11-12       | Padding              | 2      | 00 00
13          | Target Device        | 1      | Device to configure (1-4)
14          | Settings Type        | 1      | 01=hot cues, 02=memory, etc.
15-18       | Data Length          | 4      | Bytes of settings data (big-endian)
19+         | Settings Data        | var    | Serialized configuration
```

---

## Port 50004: Touch Audio

### Audio Data Packet (Type 1e)

Continuous audio stream.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 1e
11-12       | Padding              | 2      | 00 00
13          | Device Number        | 1      | Audio source device
14-15       | Sequence Number      | 2      | Packet sequence counter (big-endian)
16-19       | Timestamp            | 4      | Audio sample timestamp (big-endian)
20-21       | Audio Data Length    | 2      | Bytes of audio following (big-endian)
22+         | Audio Samples        | var    | Raw audio PCM data (stereo, 16-bit, 44.1kHz)
```

### Audio Handover Packet (Type 1f)

Audio routing control.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 1f
11-12       | Padding              | 2      | 00 00
13          | Source Device        | 1      | Current audio source
14          | Target Device        | 1      | New audio source
15          | Routing Flags        | 1      | Control flags for handover
16-27       | Padding              | 12     | Reserved
```

### Audio Timing Packet (Type 20)

Synchronization for audio playback.

```
Byte Offset | Field Name           | Length | Notes
0-9         | Header               | 10     | 51 73 70 74 31 57 6d 4a 4f 4c
10          | Packet Type          | 1      | 20
11-12       | Padding              | 2      | 00 00
13          | Device Number        | 1      | Audio timing source
14-17       | Sample Count         | 4      | Total audio samples sent (big-endian)
18-21       | Timestamp            | 4      | Reference timestamp (big-endian)
22-25       | Buffer Level         | 4      | Current buffer depth (bytes)
26-27       | Padding              | 2      | Reserved
```

---

## Common Data Encodings

### BPM Representation
- Stored as integer value = BPM * 100
- Example: 120 BPM = 0x1770 (5488 decimal)
- Range typically: 0x0BB8 (30 BPM) to 0x29A0 (300 BPM)

### Timestamps (Position)
- Milliseconds: Unsigned 32-bit big-endian
- Beats: Unsigned 32-bit big-endian (varies by device)
- Range: 0 to 0xFFFFFFFF (18+ hours at 44.1kHz)

### Device Numbers
- 1 = CDJ Deck 1
- 2 = CDJ Deck 2
- 3 = CDJ Deck 3
- 4 = CDJ Deck 4 (or Sampler/XDJ on older setups)
- 33 (0x21) = Mixer
- 0 = Unassigned/Broadcast

### Media Slot Identifiers
- 0x01 = USB
- 0x02 = SD Card
- 0x03 = Rekordbox (some devices)

### Device Type Identifiers
- 0x01 = CDJ
- 0x02 = (reserved)
- 0x03 = Mixer/DJM
- 0x04 = Rekordbox
- 0x05 = XDJ-AZ

---

## Notes

- All multi-byte integers use **big-endian** (network) byte order
- Padding bytes are typically 0x00 but may contain other data
- Packets are sent as UDP broadcasts to 255.255.255.255 on specified ports
- Some packets are sent to unicast addresses (device-to-device)
- Newer hardware may extend packet structures - older parsers should ignore extra bytes
- CDJ-3000 packets are significantly larger (0x200) due to additional metadata fields

---

## References

- Deep Symmetry DJ Link Analysis: https://djl-analysis.deepsymmetry.org/
- Wireshark Pro DJ Link Dissectors: https://github.com/nudge/wireshark-prodj-dissectors
- Beat Link Java Library: https://github.com/Deep-Symmetry/beat-link
