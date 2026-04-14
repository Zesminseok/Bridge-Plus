# Track Metadata :: DJ Link Ecosystem Analysis

Source: https://djl-analysis.deepsymmetry.org/djl-analysis/track_metadata.html

## Overview

The DJ Link ecosystem enables metadata retrieval from CDJs through a database server protocol. This document details the complete protocol for querying track information, artwork, waveforms, cue points, and beat grids.

---

## Database Connection

### Initial Port Discovery

To locate the database server port, establish a TCP connection to port **12523** and transmit:

```
0123456789abcdef
0000000f
RemoteDBServer
00
```

The player responds with a two-byte value indicating the port (typically **1051**).

### Connection Setup

After determining the port, send the initialization packet:

```
01234
1100000001
```

The server echoes these five bytes back to confirm readiness.

---

## Message Structure

### Field Types

**Number Fields:**
- Type `0f`: Single byte integer
- Type `10`: Two-byte big-endian integer
- Type `11`: Four-byte big-endian integer

**Binary Fields:**
- Type `14`: Preceded by four-byte big-endian length value

**String Fields:**
- Type `26`: UTF-16 big-endian encoding, preceded by four-byte length (in character count, not bytes), always terminated with `0000`

### Message Header Format

Messages begin with:
1. Four-byte magic value: `872349ae`
2. Four-byte transaction ID (TxID) - incremented per query
3. Two-byte message type
4. One-byte argument count (0-12)
5. Twelve-byte blob specifying argument types (padded with zeros if fewer arguments)
6. Variable argument fields

### Argument Tags

- `02`: UTF-16 big-endian string with NUL terminator
- `03`: Binary blob
- `06`: Four-byte big-endian integer

---

## DMST Parameter

The DMST parameter combines four bytes:
- Byte 0: `D` - Virtual player number (1-4)
- Byte 1: `M` - Menu location (1=main, 2=submenu/popup, 8=graphical/data)
- Byte 2: `Sr` - Slot identifier
- Byte 3: `Tr` - Track type

---

## Query Context Setup

Before metadata queries, establish context with TxID `fffffffe` and message type `0000`:

```
11872349ae11fffffffe1000000f01
1400100000000c (12 bytes)
0600000000000000000000002011D ours
```

Where `D` is a valid player number (1-4) representing your virtual CDJ.

The player responds with message type `4000`, echoing your device number and its own player number.

---

## Track Metadata Requests

### Rekordbox Track Metadata

Send message type `2002` with two arguments:

```
11872349ae11TxID1020020f02
1400100000000c (12 bytes)
0606000000000000000000002011D01SrTr11rekordbox
```

Where:
- `D`: Your virtual player number
- `01`: Menu location (always 1 for main menu)
- `Sr`: Slot identifier
- `Tr`: Track type (01 for rekordbox)
- `rekordbox`: Four-byte track ID

### Rendering Menu Results

After receiving metadata availability confirmation, render with message type `3000`:

```
11872349ae11TxID1030000f06
1400100000000c (12 bytes)
0606060606060000000000002011D01SrTr
1100000000110000000b113000000000110000000b1100000000
```

Arguments in order:
1. DMST value (D, 01, Sr, Tr as four bytes)
2. Offset (0 for first request)
3. Limit (number of items to fetch)
4. Unknown (send 0)
5. Total items
6. Unknown (send 0)

Response comprises three message types:
- `4001`: Menu header
- `4101`: Individual menu items (one per track metadata field)
- `4201`: Menu footer (signals completion)

---

## Track Metadata Items (11 Fields)

### Item 1: Title
- Type `04`
- Argument 1: Artist ID
- Argument 2: Rekordbox ID
- Argument 4: Track title text
- Argument 9: Artwork ID

### Item 2: Artist
- Type `07`
- Argument 2: Artist ID
- Argument 4: Artist name

### Item 3: Album
- Type `02`
- Argument 4: Album title

### Item 4: Duration
- Type `0b`
- Argument 2: Length in seconds

### Item 5: Tempo
- Type `0d`
- Argument 2: BPM x 100

### Item 6: Comment
- Type `23`
- Argument 4: Comment text

### Item 7: Key
- Type `0f`
- Argument 4: Key signature text

### Item 8: Rating
- Type `0a`
- Argument 2: Star rating (0-5)

### Item 9: Color
- Type `13`-`1b` (13=none, 14=pink, 15=red, etc.)
- Argument 4: Color label text

### Item 10: Genre
- Type `06`
- Argument 2: Genre ID
- Argument 4: Genre name

### Item 11: Date Added
- Type `2e`
- Argument 4: Date in "yyyy-mm-dd" format

---

## Album Artwork

### Requesting Artwork

Send message type `2003`:

```
11872349ae11TxID1020030f02
1400100000000c (12 bytes)
0606000000000000000000002011D08SrTr11artwork
```

Response is message type `4002` with four arguments:
1. Request type echo (`2003`)
2. Zero value
3. Image length in bytes
4. Blob containing image data (omitted if length is zero)

**High-resolution variant:** Add numeric argument with value 1 at message end for 240x240 pixels instead of 80x80.

**Non-rekordbox artwork:** Add numeric argument with value 2 for artwork from unanalyzed tracks.

---

## Beat Grids

### Requesting Beat Grid

Send message type `2204`:

```
11872349ae11TxID1022040f02
1400100000000c (12 bytes)
0606000000000000000000002011D08SrTr11rekordbox
```

Response is message type `4602` with four arguments:
1. Request type echo (`2204`)
2. Zero value
3. Beat grid length in bytes
4. Blob containing grid data (omitted if length is zero)

### Beat Grid Entry Structure

Each 16-byte entry contains (little-endian):
- Bytes 0-1: Beat-within-bar (1, 2, 3, or 4)
- Bytes 2-3: Tempo (BPM x 100)
- Bytes 4-7: Time in milliseconds at normal speed

Subsequent beats found at 16-byte intervals.

---

## Waveform Previews

### Monochrome Preview

Send message type `2004` with five arguments specified but only four present:

```
11872349ae11TxID1020040f05
1400100000000c (12 bytes)
0606060603000000000000002011D08SrTr110000000411rekordbox113000000000
```

The fifth (blob) argument is omitted to signal a preview request.

Response is message type `4402` containing four arguments, the fourth being a blob with 900 bytes:
- First 800 bytes: 400 columns of waveform data (two-byte pairs per column)
  - First byte: Height (0-31 pixels)
  - Second byte: Whiteness (0=blue, 7=white)
- Final 100 bytes: Compact 100-column preview for CDJ 900 players

### Detailed Waveform

Send message type `2904`:

```
11872349ae11TxID1029040f03
1400100000000c (12 bytes)
0606060000000000000000002011D08SrTr11rekordbox1100000000
```

Response is message type `4a02`. Waveform detail consists of one byte per segment (150 segments per second):
- Three high-order bits: Color (0-7, dark blue to near-white)
- Five low-order bits: Height (0-31 pixels)

---

## Nxs2 Enhanced Waveforms

### Color Preview

Send message type `2c04` requesting tag `PWV4` from `EXT` file:

```
11872349ae11TxID102c040f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11rekordbox1134565750113000545845
```

- Tag `PWV4` encoded big-endian: `1134565750`
- Extension `EXT` encoded big-endian: `113000545845`

Response is message type `4f02` with five arguments, the fourth being 7,200-byte blob with 1,200 columns of preview data.

**Six-channel structure:** Each column comprises six bytes:
- Bytes 0-1: Whiteness channels
- Byte 2: Low-frequency energy
- Byte 3: Bottom-third frequency energy
- Byte 4: Mid-frequency energy
- Byte 5: Top-frequency energy

### Color Detail

Request tag `PWV5` from `EXT` file (identical message except tag differs).

Response type `4f02` with variable-length blob. Each two-byte segment encodes (bits 15-0):
- Bits 15-13: Red intensity
- Bits 12-10: Green intensity
- Bits 9-7: Blue intensity
- Bits 6-0: Height (0-31 pixels)

---

## CDJ-3000 3-Band Waveforms

### Three-Band Preview

Send message type `2c04` requesting tag `PWV6` from `2EX` file:

```
11872349ae11TxID102c040f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11rekordbox1136565750113000584532
```

Response message type `4f02` contains 3,600-byte blob (1,200 columns x 3 bytes):
- Byte 0: Mid-range height
- Byte 1: High-frequency height
- Byte 2: Low-frequency height

### Three-Band Detail

Request tag `PWV7` from `2EX` file. Same three-byte structure per segment as preview.

---

## Vocal Detection Configuration

### Requesting Vocal Config

Send message type `2c04` requesting tag `PWVC` from `2EX` file:

```
11872349ae11TxID102c040f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11rekordbox1143565750113000584532
```

Response type `4f02` contains 6-byte vocal configuration:
- Bytes 0-1: Unknown (zero)
- Bytes 2-3: Low-frequency threshold (big-endian)
- Bytes 4-5: Mid-frequency threshold (big-endian)
- Bytes 6-7: High-frequency threshold (big-endian)

Observed ranges: low 80-114, mid 80-146, high 98-159.

---

## Cue Points and Loops

### Legacy Cue Points

Send message type `2104`:

```
11872349ae11TxID1021040f02
1400100000000c (12 bytes)
0606000000000000000000002011D08SrTr11rekordbox
```

Response type `4702` with nine arguments. Fourth argument is blob containing 24-byte entries:

**Cue/Loop Entry Structure:**
- Byte 0: Loop flag (01=loop, 00=cue only)
- Byte 1: Cue flag (01=contains cue, 00=ignore)
- Byte 2: Hot cue identifier (00=memory, 01-03=hot A-C)
- Bytes 3-11: Unknown/padding
- Bytes 12-15: Cue position in seconds (little-endian)
- Bytes 16-19: Loop end position in seconds (little-endian)
- Bytes 20-23: Unknown/padding

Arguments in response:
1. Request type echo
2. Zero value
3. Blob length
4. Blob containing entries
5. Unknown (typically `0x24`)
6. Number of hot cue entries
7. Number of memory point entries
8. Length of trailing unknown blob
9. Unknown blob data

### Extended Nxs2 Cue Points

Send message type `2b04`:

```
11872349ae11TxID102b040f03
1400100000000c (12 bytes)
0606060000000000000000002011D08SrTr11rekordbox1100000000
```

Response type `4e02` with five arguments. Fourth argument is variable-length blob containing extended cue entries.

**Extended Cue Entry Structure (variable length):**
- Bytes 0-3: Entry length (little-endian)
- Byte 4: Unknown
- Byte 5: Unknown
- Byte 6: Hot cue identifier (00=memory, 01-08=hot A-H)
- Byte 7: Unknown
- Byte 8: Type flag (01=memory, 02=loop)
- Bytes 9-11: Unknown
- Bytes 12-15: Cue position in seconds (little-endian)
- Bytes 16-19: Loop end position in seconds (little-endian)
- Bytes 20-21: Unknown
- Byte 22: Color ID for memory/loop (0=none)
- Bytes 23-47: Unknown padding
- Bytes 48-49: Comment length (little-endian, zero if no comment)
- Bytes 50+: UTF-16 comment (if length > 0), followed by NUL terminator
- Bytes at offset 46+length+4: Hot cue color information
  - Byte 0: Rekordbox color code
  - Bytes 1-3: RGB color values (or all zero if no color)

---

## Song Structure (Phrase Analysis)

### Requesting Song Structure

Send message type `2c04` requesting tag `PSSI` from `EXT` file:

```
11872349ae11TxID102c040f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11rekordbox1149535350113000545845
```

Response type `4f02` with song structure data in fourth argument blob.

---

## General Analysis Tag Requests

### Request Format

Send message type `2c04`:

```
11872349ae11TxID102c040f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11rekordbox11tag1130extension
```

Where:
- `tag`: Four-character ASCII tag identifier, encoded as big-endian 32-bit value
- `extension`: File extension (padded with NUL to four characters), encoded big-endian

### Known Tags and Extensions

| Tag    | Extension | Encoded Tag    | Encoded Extension  | Description            |
|--------|-----------|----------------|--------------------|------------------------|
| `PWV4` | `EXT`     | `1134565750`   | `113000545845`     | Nxs2 color preview     |
| `PWV5` | `EXT`     | `1135565750`   | `113000545845`     | Nxs2 color detail      |
| `PWV6` | `2EX`     | `1136565750`   | `113000584532`     | CDJ-3000 3-band preview|
| `PWV7` | `2EX`     | `1137565750`   | `113000584532`     | CDJ-3000 3-band detail |
| `PWVC` | `2EX`     | `1143565750`   | `113000584532`     | Vocal detection config |
| `PSSI` | `EXT`     | `1149535350`   | `113000545845`     | Song structure (phrase) |

Response type `4f02` contains five arguments, with tag data in fourth argument blob beginning at byte 34.

---

## Track Lists and Playlists

### All Tracks Query

Send message type `1004`:

```
11872349ae11TxID1010040f02
1400100000000c (12 bytes)
0606000000000000000000002011D01SrTr11sort
```

Where `sort` parameter determines ordering and item types returned.

Render results with message type `3000` in batches (max 64 items safely recommended).

### Playlist/Folder Request

Send message type `1105`:

```
11872349ae11TxID1011050f04
1400100000000c (12 bytes)
0606060600000000000000002011D01SrTr11sort11id1130folder?
```

Arguments:
- `sort`: Same ordering options as track list
- `id`: Playlist/folder ID (0 for root folder)
- `folder?`: 1 for folder request, 0 for playlist request

### Sort Orders and Item Types

| Sort | Item Type | Sorted By         | Arg 1      | Arg 6        |
|------|-----------|--------------------|------------|--------------|
| 01   | 0704      | Title              | Artist ID  | Artist name  |
| 02   | 0704      | Artist             | Artist ID  | Artist name  |
| 03   | 0204      | Album              | Album ID   | Album name   |
| 04   | 0d04      | BPM                | BPM x 100  | (empty)      |
| 05   | 0a04      | Rating             | Rating     | (empty)      |
| 06   | 0604      | Genre              | Genre ID   | Genre name   |
| 07   | 2304      | Comment            | Comment ID | Comment text |
| 08   | 0b04      | Duration           | Seconds    | (empty)      |
| 09   | 2904      | Remixer            | Remixer ID | Remixer name |
| 0a   | 0e04      | Label              | Label ID   | Label name   |
| 0b   | 2804      | Original Artist    | Artist ID  | Artist name  |
| 0c   | 0f04      | Key                | Key ID     | Key text     |
| 0d   | 1004      | Bit rate           | Bit rate   | (empty)      |
| 10   | 2a04      | DJ play count      | Play count | (empty)      |
| 11   | 2e04      | Date added         | Date ID    | Date text    |

### Menu Item Types (Complete Reference)

| Type   | Meaning                          |
|--------|----------------------------------|
| 0001   | Folder                           |
| 0002   | Album title                      |
| 0003   | Disc                             |
| 0004   | Track Title                      |
| 0006   | Genre                            |
| 0007   | Artist                           |
| 0008   | Playlist                         |
| 000a   | Rating                           |
| 000b   | Duration                         |
| 000d   | Tempo                            |
| 000e   | Label                            |
| 000f   | Key                              |
| 0010   | Bit Rate                         |
| 0011   | Year                             |
| 0013   | Color None                       |
| 0014   | Color Pink                       |
| 0015   | Color Red                        |
| 0016   | Color Orange                     |
| 0017   | Color Yellow                     |
| 0018   | Color Green                      |
| 0019   | Color Aqua                       |
| 001a   | Color Blue                       |
| 001b   | Color Purple                     |
| 0023   | Comment                          |
| 0024   | History Playlist                 |
| 0028   | Original Artist                  |
| 0029   | Remixer                          |
| 002e   | Date Added                       |
| 0080   | Genre menu                       |
| 0081-008c | Various menu types            |
| 008e   | Color menu                       |
| 0090   | Folder menu                      |
| 0091   | Search menu                      |
| 0092   | Time menu                        |
| 0093   | Bit Rate menu                    |
| 0094   | Filename menu                    |
| 0095   | History menu                     |
| 0098   | Hot cue bank menu                |
| 00a0   | All                              |
| 0204   | Track Title and Album            |
| 0604   | Track Title and Genre            |
| 0704   | Track Title and Artist           |
| 0a04   | Track Title and Rating           |
| 0b04   | Track Title and Time             |
| 0d04   | Track Title and BPM              |
| 0e04   | Track Title and Label            |
| 0f04   | Track Title and Key              |
| 1004   | Track Title and Bit Rate         |
| 1a04   | Track Title and Color            |
| 2304   | Track Title and Comment          |
| 2804   | Track Title and Original Artist  |
| 2904   | Track Title and Remixer          |
| 2a04   | Track Title and DJ Play Count    |
| 2e04   | Track Title and Date Added       |

**CDJ-3000 Note:** Mask menu item type field with `0xffff` to account for additional data in high bytes.

---

## Non-Rekordbox Track Metadata

For non-rekordbox tracks, use message type `2202` instead of `2002`, and adjust `Tr` parameter:
- `02`: Non-rekordbox tracks from media slots
- `05`: CD audio tracks from CD slot (with `Sr` = `01`)

Otherwise, follow the same query procedure. CD tracks use simple track numbers instead of rekordbox IDs.

**Hardware limitation:** Older nexus-era players require properly-formatted CDJ status packets from your virtual player. CDJ-3000s do not have this limitation and can provide beat grids and waveforms for locally-analyzed tracks.

---

## Frames

Track positions reference "frames" at 75 frames per second, with positioning at half-frame boundaries (150 positions per second). Player displays show frame values with decimal points (e.g., "00.0" to "74.5"), where `.0` and `.5` indicate frame boundaries.

---

## Connection Teardown

Send message with TxID `fffffffe` and message type `1001`:

```
11872349ae11fffffffe1001000f00
1400100000000c (12 bytes)
000000000000000000000000
```

---

## Protocol Implementation Notes

1. Transaction IDs start at 1, increment per query, and appear in all related responses
2. Multiple messages may arrive in single network packets; parse by message length, not packet boundaries
3. Messages may be fragmented across packets (handle defensively)
4. Variable-length blob fields omitted when preceding length value is zero
5. Little-endian encoding used exclusively for beat grids and cue points (exception to general big-endian protocol)
6. Status packets from virtual CDJ establish context for database server state machine
7. Database server maintains limited state table (sufficient for 3 other players)
8. Message argument tags (02, 03, 06) differ from field types (0f, 10, 11, 14, 26) for undocumented reasons
