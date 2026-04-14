# Pro DJ Link Protocol - Implementation Guide
Practical Examples and Integration Patterns

## Quick Start: Virtual CDJ Setup

### 1. Network Configuration
```
UDP Port 50000: Device discovery and channel assignment
UDP Port 50001: Beat synchronization and tempo control
UDP Port 50002: Detailed device status and media control
UDP Port 50004: Touch audio data (optional for audio features)

Broadcast Address: 255.255.255.255
Ports: Standard UDP (connectionless)
```

### 2. Discovering Devices

**Step 1: Send Keep-Alive Packet**

Create a keep-alive packet (Type 0x06) every 200-500ms:
- Bytes 0-9: Header `51 73 70 74 31 57 6d 4a 4f 4c`
- Byte 10: Type `06`
- Bytes 13-18: Your interface's MAC address
- Bytes 19-22: Your interface's IP address
- Byte 23: Your virtual device number (recommend 0x07)
- Bytes 26-42: Device name (e.g., "Virtual CDJ")

**Step 2: Listen for Responses**

Devices on the network will:
- Broadcast their keep-alive packets on port 50000 (Type 0x06)
- Send beat packets on port 50001 (Type 0x28)
- Send status packets on port 50002 (Type 0x0a)

### 3. Binding for Status Reception

**UDP Server on Port 50002**

```
// Pseudo-code
socket = create_udp_socket()
socket.bind(your_ip, 50002)
socket.setsockopt(SO_REUSEADDR, 1)

// Enable broadcast reception
socket.setsockopt(IP_MULTICAST_LOOP, 1)

// Listen indefinitely
while True:
    packet, source = socket.recvfrom(512)
    parse_packet(packet)
```

---

## Packet Parsing Examples

### Parsing Beat Packet (Type 0x28)

```python
# Beat Packet Structure
def parse_beat_packet(data):
    if len(data) < 28:
        return None
    
    # Check header
    header = data[0:10]
    if header != b'QsptMmjOl':
        return None
    
    packet_type = data[10]
    if packet_type != 0x28:
        return None
    
    half_beat = data[11]
    bpm_raw = int.from_bytes(data[12:14], 'big')
    bpm = bpm_raw / 100.0
    beat_number = data[14]
    device_number = data[17]
    
    return {
        'type': 'beat',
        'half_beat': half_beat,
        'bpm': bpm,
        'beat_number': beat_number,
        'device': device_number
    }
```

### Parsing CDJ Status (Type 0x0a)

```python
def parse_cdj_status(data):
    if len(data) < 50:
        return None
    
    packet_type = data[10]
    if packet_type != 0x0a:
        return None
    
    device_num = data[12]
    device_state = data[13]  # 0=off, 1=on
    play_state = data[14]     # 0=pause, 1=play, 2=cue
    
    bpm_raw = int.from_bytes(data[15:17], 'big')
    bpm = bpm_raw / 100.0
    
    position_ms = int.from_bytes(data[19:23], 'big')
    position_beats = int.from_bytes(data[23:27], 'big')
    
    track_id = int.from_bytes(data[27:31], 'big')
    album_id = int.from_bytes(data[31:35], 'big')
    
    device_name = data[35:51].rstrip(b'\x00').decode('ascii', errors='ignore')
    
    return {
        'type': 'cdj_status',
        'device': device_num,
        'state': device_state,
        'play_state': play_state,
        'bpm': bpm,
        'position_ms': position_ms,
        'position_beats': position_beats,
        'track_id': track_id,
        'album_id': album_id,
        'device_name': device_name
    }
```

### Parsing Mixer Status (Type 0x29)

```python
def parse_mixer_status(data):
    if len(data) < 56:
        return None
    
    packet_type = data[10]
    if packet_type != 0x29:
        return None
    
    # Channel fader positions (0-127)
    ch1_fader = data[15]
    ch2_fader = data[16]
    ch3_fader = data[17]
    ch4_fader = data[18]
    
    crossfader = data[19]
    master_level = data[20]
    headphone_level = data[21]
    
    # EQ values (0x40 = neutral)
    ch1_high = (data[23] - 0x40) * 12 / 0x40  # in dB
    ch1_mid = (data[24] - 0x40) * 12 / 0x40
    ch1_low = (data[25] - 0x40) * 12 / 0x40
    
    master_tempo_raw = int.from_bytes(data[35:37], 'big')
    master_tempo = master_tempo_raw / 100.0
    
    return {
        'type': 'mixer_status',
        'channels': [ch1_fader, ch2_fader, ch3_fader, ch4_fader],
        'crossfader': crossfader,
        'master_level': master_level,
        'headphone_level': headphone_level,
        'eq': {
            'ch1': [ch1_high, ch1_mid, ch1_low],
            'ch2': [ch2_high, ch2_mid, ch2_low],
            'ch3': [ch3_high, ch3_mid, ch3_low],
            'ch4': [ch4_high, ch4_mid, ch4_low]
        },
        'master_tempo': master_tempo
    }
```

---

## Creating Virtual CDJ Packets

### Creating Keep-Alive Packet (Type 0x06)

```python
import struct
import socket

def create_keepalive_packet(device_num=0x07, mac_bytes=None, ip_str='192.168.1.100', name='Virtual CDJ'):
    # Build packet
    packet = bytearray()
    
    # Header (bytes 0-9)
    packet.extend([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c])
    
    # Packet type (byte 10)
    packet.append(0x06)
    
    # Padding (bytes 11-12)
    packet.extend([0x00, 0x00])
    
    # MAC address (bytes 13-18)
    if mac_bytes is None:
        mac_bytes = bytes([0x00, 0x11, 0x22, 0x33, 0x44, 0x55])
    packet.extend(mac_bytes)
    
    # IP address (bytes 19-22)
    ip_parts = list(map(int, ip_str.split('.')))
    packet.extend(ip_parts)
    
    # Device number (byte 23)
    packet.append(device_num)
    
    # Padding (bytes 24-25)
    packet.extend([0x00, 0x00])
    
    # Device type (byte 26): 0x01=CDJ, 0x03=Mixer, 0x04=Rekordbox
    packet.append(0x01)
    
    # Device name (bytes 27-42, null-terminated)
    name_bytes = name.encode('ascii')[:15]
    packet.extend(name_bytes)
    packet.extend([0x00] * (16 - len(name_bytes)))  # pad with nulls
    
    # Model name (bytes 43-58, null-terminated)
    model = "Virtual CDJ"
    model_bytes = model.encode('ascii')[:15]
    packet.extend(model_bytes)
    packet.extend([0x00] * (16 - len(model_bytes)))
    
    return bytes(packet)


# Broadcast every 500ms
def broadcast_keepalive():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    
    mac = bytes([0x00, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e])  # Replace with your MAC
    ip = '192.168.1.100'  # Replace with your IP
    
    packet = create_keepalive_packet(device_num=0x07, mac_bytes=mac, ip_str=ip)
    
    while True:
        sock.sendto(packet, ('255.255.255.255', 50000))
        time.sleep(0.5)  # 500ms interval
```

### Creating Beat Packet (Type 0x28)

```python
def create_beat_packet(bpm=120, beat_number=1, device_num=1):
    packet = bytearray()
    
    # Header
    packet.extend([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c])
    
    # Type: Beat
    packet.append(0x28)
    
    # Half-beat flag
    packet.append(0x00)
    
    # BPM (scaled: BPM * 100, big-endian)
    bpm_scaled = int(bpm * 100)
    packet.extend(struct.pack('>H', bpm_scaled))
    
    # Beat number (1-4)
    packet.append(beat_number & 0x0F)
    
    # Padding
    packet.extend([0x00, 0x00])
    
    # Device number
    packet.append(device_num)
    
    # Padding (10 bytes)
    packet.extend([0x00] * 10)
    
    return bytes(packet)
```

---

## Connecting to Track Metadata

Track metadata queries use **TCP** (not UDP) after device discovery:

```python
import struct
import socket

def query_track_metadata(device_ip, device_port=12112, track_id=1):
    """
    Connect via TCP to device on port 12112 (or 12113, 12114, 12115 for other decks)
    Fetch track information from Rekordbox database
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((device_ip, device_port))
    
    # Protocol handshake and query structure varies
    # See Beat Link library documentation for detailed TCP packet format
    
    # This is simplified - actual implementation requires proper TCP protocol handling
    query = build_metadata_query(track_id)
    sock.send(query)
    
    response = sock.recv(4096)
    metadata = parse_metadata_response(response)
    
    sock.close()
    return metadata
```

---

## Tempo Master Negotiation

### Requesting Master Status

```python
def create_master_request(device_num=1, current_bpm=120):
    """Create Master Handoff Request (Type 0x26)"""
    packet = bytearray()
    
    # Header
    packet.extend([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c])
    
    # Type: Master Request
    packet.append(0x26)
    
    # Padding
    packet.extend([0x00, 0x00])
    
    # Device number requesting master
    packet.append(device_num)
    
    # Current BPM
    packet.append(int(current_bpm) & 0xFF)
    
    # Padding
    packet.extend([0x00] * 13)
    
    return bytes(packet)


def handle_master_response(packet):
    """Parse Master Handoff Response (Type 0x27)"""
    if packet[10] == 0x27:
        new_master = packet[13]
        return {
            'new_master': new_master,
            'status': 'master_assigned'
        }
```

---

## Common Integration Patterns

### 1. Beat-Locked Lighting Control

```python
class BeatLinkedLighting:
    def __init__(self):
        self.current_beat = 0
        self.bpm = 120
        self.beat_callback = None
    
    def on_beat_packet(self, beat_data):
        self.current_beat = beat_data['beat_number']
        self.bpm = beat_data['bpm']
        
        # Trigger lighting effects synchronized to beat
        if self.beat_callback:
            self.beat_callback(self.current_beat, self.bpm)
    
    def set_beat_callback(self, callback):
        self.beat_callback = callback


# Usage
lights = BeatLinkedLighting()
lights.set_beat_callback(lambda beat, bpm: trigger_light_flash(beat, bpm))
```

### 2. Track Change Detection

```python
class TrackMonitor:
    def __init__(self):
        self.current_tracks = {}
        self.track_change_callback = None
    
    def on_status_packet(self, status):
        device = status['device']
        track_id = status['track_id']
        
        # Check if track changed
        if device in self.current_tracks:
            if self.current_tracks[device] != track_id:
                if self.track_change_callback:
                    self.track_change_callback(device, track_id)
        
        self.current_tracks[device] = track_id


# Usage
monitor = TrackMonitor()
monitor.track_change_callback = lambda dev, track: on_new_track(dev, track)
```

### 3. Tempo Following

```python
class TempoFollower:
    def __init__(self, target_bpm=120):
        self.target_bpm = target_bpm
        self.current_bpm = target_bpm
        self.smoothing_factor = 0.1
    
    def update_tempo(self, new_bpm):
        # Smooth tempo changes with exponential moving average
        self.current_bpm = (
            self.smoothing_factor * new_bpm + 
            (1 - self.smoothing_factor) * self.current_bpm
        )
        return self.current_bpm
    
    def beat_to_milliseconds(self, beat_number):
        # Convert beat number to time offset
        ms_per_beat = 60000 / self.current_bpm
        return beat_number * ms_per_beat


# Usage
follower = TempoFollower()
# Update with received BPM
smooth_bpm = follower.update_tempo(122.5)
```

---

## Error Handling & Robustness

### Packet Validation

```python
def validate_packet(data):
    """Validate DJ Link packet integrity"""
    
    # Minimum size check
    if len(data) < 28:
        return False, "Packet too short"
    
    # Header validation
    if data[0:10] != b'QsptMmjOl':
        return False, "Invalid header"
    
    # Type validation
    pkt_type = data[10]
    valid_types = {
        50000: [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x08, 0x0a],
        50001: [0x02, 0x03, 0x0b, 0x26, 0x27, 0x28, 0x2a],
        50002: [0x05, 0x06, 0x0a, 0x19, 0x1a, 0x29, 0x34],
        50004: [0x1e, 0x1f, 0x20]
    }
    
    # Note: actual port would need to be tracked separately
    
    return True, "Valid"


def safe_parse_packet(data, port):
    """Safely parse with error handling"""
    try:
        is_valid, msg = validate_packet(data)
        if not is_valid:
            return None
        
        pkt_type = data[10]
        
        if port == 50001 and pkt_type == 0x28:
            return parse_beat_packet(data)
        elif port == 50002 and pkt_type == 0x0a:
            return parse_cdj_status(data)
        elif port == 50002 and pkt_type == 0x29:
            return parse_mixer_status(data)
        
    except Exception as e:
        print(f"Parse error: {e}")
    
    return None
```

---

## Testing & Debugging

### Using Wireshark

```bash
# Capture DJ Link traffic
sudo tcpdump -i en0 'udp port 50000 or udp port 50001 or udp port 50002 or udp port 50004' -w djlink.pcap

# View with Wireshark dissectors
# Install: https://github.com/nudge/wireshark-prodj-dissectors
```

### Packet Dump Utility

```python
def dump_packet(data):
    """Debug utility to display packet contents"""
    print(f"Packet length: {len(data)} bytes")
    print("Hex dump:")
    for i in range(0, len(data), 16):
        hex_str = ' '.join(f'{b:02x}' for b in data[i:i+16])
        ascii_str = ''.join(chr(b) if 32 <= b < 127 else '.' for b in data[i:i+16])
        print(f"  {i:04x}: {hex_str:<48} {ascii_str}")
    
    print(f"\nHeader: {data[0:10]}")
    print(f"Type: 0x{data[10]:02x}")
```

---

## Resources

- **Deep Symmetry Documentation**: https://djl-analysis.deepsymmetry.org/
- **Beat Link Library**: https://github.com/Deep-Symmetry/beat-link
- **Wireshark Dissectors**: https://github.com/nudge/wireshark-prodj-dissectors
- **prolink-go**: https://github.com/EvanPurkhiser/prolink-go
- **python-prodj-link**: https://github.com/flesniak/python-prodj-link
