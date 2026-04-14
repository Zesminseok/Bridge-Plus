# Packet Types :: DJ Link Ecosystem Analysis

Source: https://djl-analysis.deepsymmetry.org/djl-analysis/packets.html
(Includes content from sub-pages: startup, beats, vcdj, sync, mixer_integration, loading_tracks, media)

## Protocol Foundation

All DJ Link packets begin with a fixed 10-byte header: `51 73 70 74 31 57 6d 4a 4f 4c` (ASCII: "Qspt1WmJOL").
This is followed by a byte which (combined with the port on which it was received) identifies the packet type.

---

## Known UDP Packet Types

### Port 50000 Packets

Device announcement and channel number negotiation.

| Kind   | Purpose                                          |
|--------|--------------------------------------------------|
| `00`   | First-stage channel number claim                 |
| `01`   | Mixer assignment intention                       |
| `02`   | Second-stage channel number claim                |
| `03`   | Mixer channel assignment                         |
| `04`   | Final-stage channel number claim                 |
| `05`   | Mixer assignment finished                        |
| `06`   | Device keep-alive                                |
| `08`   | Channel Conflict                                 |
| `0a`   | Initial device announcement                      |

### Port 50001 Packets

Beat synchronization and mixer features.

| Kind   | Purpose                                          |
|--------|--------------------------------------------------|
| `02`   | Fader Start                                      |
| `03`   | Channels On Air                                  |
| `0b`   | Absolute Position                                |
| `26`   | Master Handoff Request                           |
| `27`   | Master Handoff Response                          |
| `28`   | Beat                                             |
| `2a`   | Sync Control                                     |

### Port 50002 Packets

Detailed device status and media information.

| Kind   | Purpose                                          |
|--------|--------------------------------------------------|
| `05`   | Media Query                                      |
| `06`   | Media Response                                   |
| `0a`   | CDJ Status                                       |
| `19`   | Load Track Command                               |
| `1a`   | Load Track Acknowledgment                        |
| `29`   | Mixer Status                                     |
| `34`   | Load Settings Command                            |

### Port 50004 Packets

Touch audio data between supported players and mixers.

| Kind   | Purpose                                          |
|--------|--------------------------------------------------|
| `1e`   | Audio Data                                       |
| `1f`   | Audio Handover                                   |
| `20`   | Audio Timing                                     |

---

# Mixer and CDJ Startup

## Device Number Assignments

- Mixer: `0x21` (33 decimal)
- CDJ Channel 1-4: `0x01`-`0x04`
- CDJ-3000 Channel 5-6: `0x05`-`0x06`
- Opus Quad Mixer: `0x21`

## Mixer Startup Sequence

### Initial Announcement Packets

Frequency: ~300ms intervals | Port: 50000 (broadcast) | Length: `0x25` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x00   | Header `5173707431576d4a4f4c`          |
| 0x0a   | `0a` (device type identifier)          |
| 0x10   | Device Name (padded with `00`)         |
| 0x20   | `01`                                   |
| 0x21   | `02`                                   |
| 0x22   | lenp (`0x0025`)                        |
| 0x24   | `02` (mixer payload)                   |

### First-Stage Device Number Claim

Frequency: ~300ms | Port: 50000 (broadcast) | Length: `0x2c` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `00`                                   |
| 0x10   | Device Name                            |
| 0x20   | `01`                                   |
| 0x21   | `02`                                   |
| 0x22   | lenp (`0x002c`)                        |
| 0x23   | MAC address                            |
| 0x24   | N (01, 02, or 03 in sequence)          |

### Second-Stage Device Number Claim

Port: 50000 (broadcast) | Length: `0x32` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `02`                                   |
| 0x10   | Device Name                            |
| 0x20   | `01`                                   |
| 0x21   | `02`                                   |
| 0x22   | lenp (`0x0032`)                        |
| 0x23   | IP address                             |
| 0x2b   | MAC address                            |
| 0x2e   | D (device number, `0x21` for mixer)    |
| 0x2f   | N (01, 02, or 03)                      |

### Final-Stage Device Number Claim

Port: 50000 (broadcast) | Length: `0x2a` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `04`                                   |
| 0x10   | Device Name                            |
| 0x20   | `01`                                   |
| 0x21   | `02`                                   |
| 0x22   | lenp (`0x002a`)                        |
| 0x24   | D (device number)                      |
| 0x25   | N (01, 02, or 03)                      |

### Mixer Keep-Alive Packets

Frequency: ~1.5 seconds | Port: 50000 (broadcast) | Length: `0x36` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `06`                                   |
| 0x10   | Device Name                            |
| 0x20   | `01`                                   |
| 0x21   | `02`                                   |
| 0x22   | lenp (`0x0036`)                        |
| 0x24   | D (device number)                      |
| 0x25   | `02`                                   |
| 0x26   | MAC address                            |
| 0x2e   | IP address                             |
| 0x32   | `30`                                   |
| 0x33   | p (peer count, including self)         |
| 0x34   | `00`                                   |
| 0x35   | `00`                                   |
| 0x36   | `02`                                   |

## CDJ Startup Sequence

### CDJ Initial Announcement

Port: 50000 (broadcast) | Length: `0x25` bytes

Same as mixer but byte 0x24 = `01` (mixer uses `02`).

### CDJ First-Stage Claim

Port: 50000 (broadcast) | Length: `0x2c` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `00`                                   |
| 0x10   | Device Name                            |
| 0x25   | `01` (differs from mixer's `02`)       |

### CDJ Second-Stage Claim

Port: 50000 (broadcast) | Length: `0x32` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `02`                                   |
| 0x2e   | D (claimed device number)              |
| 0x2f   | N (01, 02, or 03)                      |
| 0x31   | a (auto-assign: `01`=auto, `02`=specific) |

### CDJ Final-Stage Claim

Port: 50000 (broadcast) | Length: `0x2a` bytes

When auto-assign, all three packets (N=1,2,3) sent. When specific, only one (N=1).

### CDJ Keep-Alive Packets

Port: 50000 (broadcast) | Length: `0x2c` bytes

Same structure as mixer keep-alive but:
- Byte 0x25 = `01` (mixer uses `02`)
- Byte 0x36 = `01` (mixer uses `02`)

## Channel-Specific Port Startup (Mixer-Assigned)

### Mixer Assignment Intention Packet (type `01`)

Direct to CDJ | Length: `0x2f` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `01`                                   |
| 0x10   | Mixer's Device Name                    |
| 0x23   | Mixer IP address                       |
| 0x2b   | Mixer MAC address                      |
| 0x2d   | `01`                                   |

### Mixer Device Number Assignment (type `03`)

Direct to CDJ | Length: `0x27` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `03`                                   |
| 0x0b   | `01`                                   |
| 0x24   | D (assigned device number)             |
| 0x25   | N (`01`)                               |

### Mixer Assignment Finished (type `05`)

Direct to CDJ | Length: `0x26` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `05`                                   |
| 0x24   | D (mixer's device number, `0x21`)      |
| 0x25   | `01`                                   |

## CDJ-3000 Compatibility

### CDJ-3000 Initial Announcement

Length: `0x27` bytes (one byte longer than standard)

| Offset | Difference from Standard               |
|--------|----------------------------------------|
| 0x21   | `04` (standard: `02`)                  |
| 0x25   | `40`                                   |

### CDJ-3000 Stage Claims

- Byte 0x21 = `03` (standard: `02`) for all three claim stages

### CDJ-3000 Keep-Alive

- Byte 0x35 = `64` (standard: `01`) -- **Critical: wrong value causes CDJ-3000 to kick itself off network**

## Channel Conflict Packet (type `08`)

Direct to new player | Length: `0x29` bytes

| Offset | Content                                |
|--------|----------------------------------------|
| 0x0a   | `08`                                   |
| 0x10   | Existing player's Device Name          |
| 0x24   | D (contested device number)            |
| 0x25   | Existing device IP address             |

---

# Beat Packets (Port 50001)

## Beat Packet Structure (96 bytes)

| Offset    | Field       | Description                              |
|-----------|-------------|------------------------------------------|
| 0x0B      | Device Name | Padded with `00`                         |
| 0x20      | Subtype     | `00` for beat packets                    |
| 0x21      | D           | Player number (1-4), `21` for mixer      |
| 0x22-0x23 | lenr        | Length of remaining data (`003c`)         |
| 0x24-0x27 | nextBeat    | Milliseconds until next beat             |
| 0x28-0x2B | 2ndBeat     | Milliseconds until second beat           |
| 0x2C-0x2F | nextBar     | Milliseconds until next measure          |
| 0x30-0x33 | 4thBeat     | Milliseconds until fourth beat           |
| 0x34-0x37 | 2ndBar      | Milliseconds until second measure        |
| 0x38-0x3B | 8thBeat     | Milliseconds until eighth beat           |
| 0x54-0x57 | Pitch       | Four-byte pitch adjustment               |
| 0x5A-0x5B | BPM         | Track BPM x 100                          |
| 0x5C      | Bb          | Beat counter within bar (1-4)            |
| 0x5F      | D           | Device number (redundant)                |

### Pitch Calculation

- `0x00100000` = 0% (no adjustment)
- `0x00000000` = -100% (complete stop)
- `0x00200000` = +100% (double speed)
- Percentage = (Pitch / 0x100000) * 100

### BPM Calculation

- Track BPM = bytes[0x5A:0x5C] / 100
- Effective BPM = Track BPM * (Pitch / 0x100000)

---

# Absolute Position Packets (Port 50001, CDJ-3000+)

Sent every 30 milliseconds. Transmitted while track is loaded, even while not playing.

## Absolute Position Packet Structure (96 bytes)

| Offset    | Field       | Description                              |
|-----------|-------------|------------------------------------------|
| 0x0B      | Device Name | Padded with `00`                         |
| 0x20      | Subtype     | `02`                                     |
| 0x21      | D           | Player identifier                        |
| 0x22-0x23 | lenr        | Remaining packet length                  |
| 0x24-0x27 | TrackLength | Track duration in seconds (rounded down) |
| 0x28-0x2B | Playhead    | Position in milliseconds                 |
| 0x2C-0x2F | Pitch       | Signed 32-bit integer (pitch x 100)      |
| 0x30-0x33 | BPM         | Effective tempo x 10; `ffffffff` = unknown |

Pitch format: 3.26% = `0146` (326 decimal). Much simpler than beat packet format.

---

# CDJ Status Packets (Port 50002)

## Virtual CDJ Setup

Bind UDP socket on port 50002. Send keep-alive packets resembling CDJ every ~1.5 seconds to port 50000 broadcast. Status packets arrive ~200ms intervals.

## Packet Sizes by Device

| Device          | Length (hex) | Length (decimal) |
|-----------------|--------------|------------------|
| Older players   | `d0`         | 208              |
| Nexus players   | `d4`         | 212              |
| XDJ-1000        | `11b`        | 283              |
| Nxs2 players    | `11c`-`124`  | 284-292          |
| CDJ-3000        | `200`        | 512              |

## Mixer Status Packets (38 bytes)

| Offset    | Field    | Description                                  |
|-----------|----------|----------------------------------------------|
| 0-19      | Name     | Device Name padded with `00`                 |
| 20        | Subtype  | `00`                                         |
| 21, 24    | D        | Device number (`21` for DJM-2000nxs)         |
| 22-23     | lenr     | Remaining bytes                              |
| 27        | F        | Status: `f0`=master, `d0`=not master         |
| 28-2b     | Pitch    | Always `100000` (0%)                         |
| 30-33     | BPM      | `(bytes[30:32] >> 6) / 100`                  |
| 34        | Bb       | Beat in bar (1-4)                            |
| 36        | Mh       | `00`=no master, `ff`=master exists           |

## CDJ Status Packet Fields

### Core Header

| Offset    | Field    | Size    | Notes                        |
|-----------|----------|---------|------------------------------|
| 0-19      | Name     | 20 bytes| Null-padded                  |
| 20        |          | 1       | `01`                         |
| 21        | Subtype  | 1       | `03`, `04`, `05`, or `06`    |
| 22-23     | D        | 2       | Player number                |
| 24        | D        | 1       | Duplicate                    |
| 25-26     | lenr     | 2       | Typically `00b0`             |

### Track and Loading Information

| Offset    | Field        | Size  | Values                                          |
|-----------|--------------|-------|-------------------------------------------------|
| 27        | A (Activity) | 1     | `00`=idle, `01`=playing/searching/loading        |
| 28        | Dr (Source)  | 1     | Device that loaded track                         |
| 29        | Sr (Slot)    | 1     | See slot table                                   |
| 2a        | Tr (Type)    | 1     | `00`=none, `01`=rekordbox, `02`=unanalyzed, `05`=CD, `06`=streaming |
| 2c-2f     | Rekordbox ID | 4     | Database ID or track number                      |
| 32-33     | Track Number | 2     | Position in playlist                             |
| 35        | tsrt         | 1     | Track sort (`00`=default, `01`=title, `02`=artist, `03`=album, `04`=BPM, `05`=rating, `0c`=key) |
| 37        | tsrc         | 1     | Track source menu                                |

### Slot Source (Sr) Values

| Value | Slot                               |
|-------|-------------------------------------|
| `00`  | No track loaded                     |
| `01`  | CD drive                            |
| `02`  | SD slot                             |
| `03`  | USB slot                            |
| `04`  | Rekordbox collection (laptop)       |
| `05`  | Unknown streaming service           |
| `06`  | Streaming Direct Play               |
| `07`  | USB 2 (XDJ-AZ four-deck mode)      |
| `08`  | Unknown streaming service           |
| `09`  | Beatport LINK streaming             |

### Track Source (tsrc) Values

| Value | Source                              |
|-------|--------------------------------------|
| `00`  | No track loaded                      |
| `02`  | Artist menu                          |
| `03`  | Album menu                           |
| `04`  | Track menu                           |
| `05`  | Playlist                             |
| `06`  | BPM menu                             |
| `0c`  | Key menu                             |
| `11`  | Folder menu / CD                     |
| `12`  | Search song                          |
| `16`  | History                              |
| `1f`  | Search artist                        |
| `20`  | Search album                         |
| `28`  | Tag List                             |
| `32`  | Instant double / previous track      |

### Playback State

| Offset | Field | Values                                              |
|--------|-------|------------------------------------------------------|
| 7b     | P1    | Play Mode (see table below)                          |
| 8b     | P2    | `7a`=playing, `7e`=stopped; `6a`/`6e`=pre-nxs; `fa`/`fe`=nxs2; `9a`/`9e`=XDJ-XZ |
| 9d     | P3    | Play Mode 3 (see table below)                        |

**P1 Play Mode Values:**

| Value | Mode                              |
|-------|-----------------------------------|
| `00`  | No track loaded                   |
| `02`  | Track loading in progress         |
| `03`  | Playing normally                  |
| `04`  | Playing loop                      |
| `05`  | Paused (not at cue)               |
| `06`  | Paused at cue point               |
| `07`  | Cue Play (button held)            |
| `08`  | Cue scratch in progress           |
| `09`  | Searching forward/backward        |
| `0e`  | Audio CD spindown (idle)          |
| `11`  | End of track reached              |
| `12`  | Emergency loop active             |

**P3 Play Mode Values:**

| Value | Mode                              |
|-------|-----------------------------------|
| `00`  | No track loaded                   |
| `01`  | Paused or Reverse mode            |
| `09`  | Forward, Vinyl jog mode           |
| `0b`  | Slip play active                  |
| `0d`  | Forward, CDJ jog mode             |

### Status Flags (Byte 0x89)

```
Bit Layout: 7 6 5 4 3 2 1 0
            . P M S O . B .

Bit 6 (P): 1 = playing, 0 = idle
Bit 5 (M): 1 = tempo master
Bit 4 (S): 1 = sync mode enabled
Bit 3 (O): 1 = on-air (output audible)
Bit 1 (B): 1 = degraded to BPM Sync mode
```

### Pitch and Tempo

| Offset    | Field    | Size | Purpose                             |
|-----------|----------|------|-------------------------------------|
| 8c-8f     | Pitch1   | 4    | Current effective pitch             |
| 90-91     | Mv       | 2    | `7fff`=no track, `8000`=rekordbox, `0000`=non-rekordbox |
| 92-93     | BPM      | 2    | Track BPM x 100                     |
| 94-95     | Mslip    | 2    | Slip Mv (XDJ-1000/nxs2 only)       |
| 96-97     | BPMslip  | 2    | Slip BPM (XDJ-1000/nxs2 only)      |
| 98-9b     | Pitch2   | 4    | Local pitch fader position          |
| c0-c3     | Pitch3   | 4    | Current effective pitch (alt)       |
| c4-c7     | Pitch4   | 4    | Local pitch fader (alt)             |

Pitch reference: `0x00100000` = 0%, `0x00000000` = -100%, `0x00200000` = +100%

BPM calculation: Track BPM = bytes[0x92:0x94] / 100

### Master Status

| Offset | Field | Values                                              |
|--------|-------|------------------------------------------------------|
| 9e     | Mm    | `00`=not master, `01`=master+rekordbox, `02`=master+non-rekordbox |
| 9f     | Mh    | `ff`=normal, or device number taking over            |

### Beat and Position

| Offset    | Field         | Description                              |
|-----------|---------------|------------------------------------------|
| a0-a3     | Beat Counter  | Counts 1 through track end; `00000000`=paused at start; `ffffffff`=no rekordbox track |
| a4-a5     | Cue Countdown | Beats to next saved cue; `01ff`=no cue or >64 bars |
| a6        | Bb            | Beat in bar (1-4); `00`=no rekordbox track |
| b3        | ug            | `ff` for one packet when beat grid modified |

**Cue Countdown Mapping:**
- `01ff` = "--.- bars" (no cue or >64 bars)
- `0100` = "63.4 bars"
- Decreases by 1 per beat
- `0000` = "00.0 Bars" (at saved cue)

### Media Presence and Status

| Offset | Field | Description                                        |
|--------|-------|----------------------------------------------------|
| 6a     | Ua    | USB activity (alternates `04`/`06`)                |
| 6b     | Sa    | SD activity                                        |
| 6f     | Ul    | USB local: `04`=none, `00`=loaded, `02`/`03`=unmounting |
| 73     | Sl    | SD local: `04`=none, `00`=loaded, `02`/`03`=open/unmounting |
| 75     | L     | Link available: `01`=media present, `00`=none      |
| b7     | Mp    | Media presence: bit 0=USB, bit 1=SD (CDJ-3000)    |
| b8     | Ue    | USB unsafe eject flag                              |
| b9     | Se    | SD unsafe eject flag                               |
| ba     | el    | Emergency loop flag                                |

### Firmware and Sync

| Offset    | Field    | Description                              |
|-----------|----------|------------------------------------------|
| 7c-7f     | Firmware | ASCII firmware version                   |
| 84-87     | Syncn    | Incremented when yielding master role    |

### Packet Metadata

| Offset    | Field    | Description                              |
|-----------|----------|------------------------------------------|
| c8-cb     | Counter  | Increments per transmission (CDJ-3000 = `00000000`) |
| cc        | nx       | `0f`=nexus, `1f`=XDJ-XZ/CDJ-3000, `05`=older |
| cd        | t        | Bit 5 = Touch Audio support              |

### Settings Blocks

Settings blocks begin with header `12 34 56 78`.

**Block 1:**

| Offset | Setting              | Values                              |
|--------|----------------------|--------------------------------------|
| 0a     | Waveform Color (s3)  | `01`=Blue, `03`=RGB, `04`=3-Band    |
| 0d     | Waveform Position(s6)| `01`=Center, `02`=Left               |

**Block 2 (CDJ-3000 only):** Six bytes: `01 01 01 00 01 01`

### Advanced Position (CDJ-3000)

| Offset    | Field            | Description                          |
|-----------|------------------|--------------------------------------|
| 116-117   | Tb               | Time steps per bar                   |
| 11a-11b   | Tpos             | Position within current bar          |
| 11c       | nm               | Next memory point ID (`00`=none)     |
| 11d       | Buff             | Buffer length forward                |
| 11e       | Bufb             | Buffer length backward               |
| 11f       | Bufs             | `01`=entire track buffered           |
| 120-124   | NeedleDragPos    | Touch-screen waveform marker         |

### Master Tempo and Key (CDJ-3000)

| Offset | Field          | Description                          |
|--------|----------------|--------------------------------------|
| 158    | Mt             | Master Tempo: `00`=off, `01`=on      |
| 15c    | Key Note       | Note value (0-11)                    |
| 15d    | Key Quality    | `00`=minor, `01`=major               |
| 15e    | Key Accidental | `00`=natural, `01`=sharp, `ff`=flat, `64`=out-of-key |

**Key Lookup Table:**

Minor: Am(`00 00 00`), Bbm(`01 00 ff`), Bm(`02 00 00`), Cm(`03 00 00`), C#m(`04 00 01`), Dm(`05 00 00`), Ebm(`06 00 ff`), Em(`07 00 00`), Fm(`08 00 00`), F#m(`09 00 01`), Gm(`0a 00 00`), Abm(`0b 00 ff`)

Major: C(`00 01 00`), Db(`01 01 ff`), D(`02 01 00`), Eb(`03 01 ff`), E(`04 01 00`), F(`05 01 00`), F#(`06 01 01`), G(`07 01 00`), Ab(`08 01 ff`), A(`09 01 00`), Bb(`0a 01 ff`), B(`0b 01 00`)

### Loop Information (CDJ-3000)

| Offset    | Field    | Format                                   |
|-----------|----------|------------------------------------------|
| 1b6-1b9   | Loops    | Loop start: ms x 65536 / 1000           |
| 1be-1c1   | Loope    | Loop end: ms x 65536 / 1000             |
| 1c8-1c9   | Loopb    | Loop length in whole beats               |

---

# Sync and Tempo Master (Port 50001)

## Sync Control Packet

Destination: Port 50001 of target device

| Offset    | Field   | Description                              |
|-----------|---------|------------------------------------------|
| 0-15      | Header  | `5173707431576d4a4f4c`                   |
| 16-17     |         | `2a 00`                                  |
| 18-33     | Name    | Device Name (padded)                     |
| 34-35     |         | `01 20`                                  |
| 38-39     | D       | Sender's player number                   |
| 40-41     | lenr    | `0008`                                   |
| 44-45     | D       | Sender's player number (repeat)          |
| 46-47     | S       | Command value                            |

**Command Values:**
- `0x10` - Sync ON
- `0x20` - Sync OFF
- `0x01` - Become tempo master

## Tempo Master Handoff Request (type `26`)

Sent by device wanting to become master, to current master on port 50001.

| Offset    | Field   | Description                              |
|-----------|---------|------------------------------------------|
| 40-41     | lenr    | `0004`                                   |
| 44-45     | D       | Requesting device number                 |

## Tempo Master Handoff Response (type `27`)

Sent by current master to requesting device on port 50001.

| Offset    | Field   | Description                              |
|-----------|---------|------------------------------------------|
| 40-41     | lenr    | `0008`                                   |
| 44-45     | D       | Current master's device number           |
| 46-47     |         | `00000001`                               |

### Handoff Process

1. Outgoing master continues reporting master status
2. Sets Mh field to new master's device number
3. Sets Syncn to one greater than any other player's value
4. Incoming master sees its number in Mh, asserts master via F and Mm
5. Outgoing master observes assertion, stops reporting master, reverts Mh to `ff`

### Unsolicited Handoff

When current master is stopped AND observes a synced, playing device, master sets Mh to that device's number without formal handoff.

---

# Mixer Integration (Port 50001)

## Fader Start (type `02`)

Port 50001 on players.

| Offset | Field | Description                                  |
|--------|-------|----------------------------------------------|
| 26     | C1    | Player 1 command                             |
| 27     | C2    | Player 2 command                             |
| 28     | C3    | Player 3 command                             |
| 29     | C4    | Player 4 command                             |

**Command Values:**
- `00` - Start playing (if at cue point)
- `01` - Stop and return to cue point
- `02` - Maintain current state

Note: XDJ-XZ and CDJ-3000 do NOT support Fader Start.

## Channels On Air (type `03`)

### Four-Channel Version

Port 50001 broadcast. lenr = `0009`.

| Offset | Field | Description                                  |
|--------|-------|----------------------------------------------|
| 24     | F1    | Channel 1: `00`=off-air, `01`=on-air         |
| 25     | F2    | Channel 2                                    |
| 26     | F3    | Channel 3                                    |
| 27     | F4    | Channel 4                                    |

### Six-Channel Version (CDJ-3000/DJM-V10)

Subtype: `03`. lenr = `0011`.

| Offset | Field | Description                                  |
|--------|-------|----------------------------------------------|
| 24-27  | F1-F4 | Channels 1-4                                 |
| 35     | F5    | Channel 5                                    |
| 36     | F6    | Channel 6                                    |

---

# Loading Tracks (Port 50002)

## Load Track Command (type `19`)

Destination: Port 50002 on target player.

| Offset    | Field     | Description                              |
|-----------|-----------|------------------------------------------|
| 0x20      | Subtype   | `00`                                     |
| 0x21-0x23 | lenr      | `0034` (52 bytes following)              |
| 0x24      | D         | Device number posing as                  |
| 0x28      | Dr        | Source device containing track           |
| 0x29      | Sr        | Source slot                              |
| 0x2A      | Tr        | Track type                               |
| 0x2B-0x3F | ID        | Rekordbox track identifier               |
| 0x40      | Dest      | Target player number (D-1, zero-indexed) |

Response: Player sends type `1a` acknowledgment.

**Limitations:**
- XDJ-XZ cannot be remotely instructed to load from its own USBs
- CDJ-3000 ignores track type for unanalyzed tracks, treats as rekordbox ID

## Load Settings Command (type `34`)

Destination: Port 50002 | Size: 116 bytes

| Offset | Field               | Values                                    |
|--------|---------------------|-------------------------------------------|
| 0x1F   | Type                | `02` (settings packet)                    |
| 0x20   | D                   | Sending device                            |
| 0x21   | Ds                  | Destination player                        |
| 0x22-23| lenr                | `0050` (80 bytes)                         |
| 0x2C   | On Air Display      | `80`=off, `81`=on                         |
| 0x2D   | LCD Brightness      | `81`-`85` (low to max)                    |
| 0x2E   | Quantize            | `80`=off, `81`=on                         |
| 0x2F   | Auto Cue Level      | `80`-`88` (-36dB to -78dB / Memory)       |
| 0x30   | Language            | `81`-`92` (English through Turkish)       |
| 0x32   | Jog Ring Brightness | `80`=off, `81`=dim, `82`=bright           |
| 0x33   | Jog Ring Indicator  | `80`=off, `81`=on                         |
| 0x34   | Slip Flashing       | `80`=off, `81`=on                         |
| 0x38   | Disc Slot Brightness| `80`=off, `81`=dim, `82`=bright           |
| 0x39   | Eject/Load Lock     | `80`=unlock, `81`=lock                    |
| 0x3A   | Sync                | `80`=off, `81`=on                         |
| 0x3B   | Autoplay Mode       | `80`=continue, `81`=single                |
| 0x3C   | Beat Quantize Value | `80`=full, `81`=1/2, `82`=1/4, `83`=1/8  |
| 0x3D   | Hot Cue Auto Load   | `80`=off, `81`=on, `82`=track setting     |
| 0x3E   | Hot Cue Color       | `80`=off, `81`=on                         |
| 0x41   | Needle Lock         | `80`=unlock, `81`=lock                    |
| 0x44   | Time Mode           | `80`=elapsed, `81`=remaining              |
| 0x45   | Jog Mode            | `80`=CDJ, `81`=vinyl                      |
| 0x46   | Auto Cue            | `80`=off, `81`=on                         |
| 0x47   | Master Tempo        | `80`=off, `81`=on                         |
| 0x48   | Tempo Range         | `80`=+/-6, `81`=+/-10, `82`=+/-16, `83`=wide |
| 0x49   | Phase Meter         | `80`=type 1, `81`=type 2                  |
| 0x4C   | Vinyl Speed Adjust  | `80`=touch&release, `81`=touch, `82`=release |
| 0x4D   | Jog Display         | `80`=auto, `81`=info, `82`=simple, `83`=artwork |
| 0x4E   | Pad Brightness      | `81`-`84` (low to max)                    |
| 0x4F   | Jog LCD Brightness  | `81`-`85` (low to max)                    |

---

# Media Slot Queries (Port 50002)

## Media Query Packet (type `05`)

Destination: Port 50002 on target player.

| Offset    | Field | Description                              |
|-----------|-------|------------------------------------------|
| 0x0a      | Type  | `05`                                     |
| 0x28      | lenr  | `000c` (12 bytes follow)                 |
| 0x2c-0x2f | IP    | Sender IP address                        |
| 0x34      | Dr    | Device owning slot                       |
| 0x38      | Sr    | Target slot number                       |

## Media Response Packet (type `06`)

| Offset    | Field          | Description                          |
|-----------|----------------|--------------------------------------|
| 0x0a      | Type           | `06`                                 |
| 0x28      | lenr           | `009c`                               |
| 0x2c-0x3f | Media Name     | UTF-16, up to 40 bytes, null-padded  |
| 0x6c-0x93 | Creation Date  | UTF-16, up to 40 bytes               |
| 0xa6-0xa7 | Tracks Count   | Number of rekordbox tracks           |
| 0xa8      | col            | UI tint color                        |
| 0xaa      | Tr             | `01`=rekordbox DB, `02`=unanalyzed   |
| 0xab      | set            | Non-zero = My Settings present       |
| 0xae-0xaf | Playlists      | Number of playlists                  |
| 0xb0-0xb7 | Total Space    | 8-byte capacity                      |
| 0xb8-0xbf | Free Space     | 8-byte unused capacity               |

### Media UI Color Values

| Value | Color   |
|-------|---------|
| `00`  | Default |
| `01`  | Pink    |
| `02`  | Red     |
| `03`  | Orange  |
| `04`  | Yellow  |
| `05`  | Green   |
| `06`  | Aqua    |
| `07`  | Blue    |
| `08`  | Purple  |

### Media Slot Broadcasts

Standalone CDJs periodically broadcast media slot info (type `06`) without being queried.
All-in-one units (XDJ-XZ, XDJ-RX, Opus Quad) do NOT send unsolicited broadcasts -- active queries required.

---

# XDJ-XZ / Opus Quad / XDJ-AZ Limitations

- XDJ-XZ does NOT send "assignment finished" packet (type `05`)
- XDJ-XZ skips final-stage claim packet series
- XDJ-XZ does not broadcast media slot information (type `06`)
- Opus Quad exposes 3 network device IDs: 1 (Player 1), 2 (Player 2), 33 (mixer)
- XDJ-AZ: Full Pro DJ Link but only 2 of 4 internal decks exposed to network

---

# Rekordbox Status Packets

Rekordbox sends mixer-format packets with device name "rekordbox".
- Device number: typically `11` (uses conflict resolution if needed)
- Mobile rekordbox: starts at `29` and increments
- Status Flag (F): `c0` (playing, not synced/master/on-air)
- Pitch: Fixed at `100000` (0%)
- Beat in Bar (Bb): Always `00`
