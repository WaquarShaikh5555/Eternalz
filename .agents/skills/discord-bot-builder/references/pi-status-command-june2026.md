# Raspberry Pi 5 Status Command (June 2026)

## `!pi` DM Command
Added to Zzzilla bot's DM command handler. Triggered by: `!pi`, `!pi5`, `!rpi`, or just `pi`.

## Implementation
```python
def get_pi_status():
    """Get Raspberry Pi 5 system status: temp, storage, uptime, network devices."""
    import subprocess, os, re
    result = {"temp_c": None, "storage": {}, "uptime": "", "ips": [], "net_devices": [], "load": ""}

    # CPU temperature
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            millideg = int(f.read().strip())
            result["temp_c"] = round(millideg / 1000, 1)
    except:
        try:
            r = subprocess.run(["/opt/vc/bin/vcgencmd", "measure_temp"], capture_output=True, timeout=5)
            m = re.search(r"temp=([\d.]+)", r.stdout.decode())
            if m:
                result["temp_c"] = float(m.group(1))
        except:
            pass

    # Storage
    try:
        r = subprocess.run(["df", "-h", "/"], capture_output=True, timeout=5, text=True)
        parts = r.stdout.strip().split("\n")[1].split()
        result["storage"] = {"size": parts[1], "used": parts[2], "avail": parts[3], "pct": parts[4]}
    except:
        pass

    # Uptime and load
    try:
        with open("/proc/uptime") as f:
            secs = float(f.read().split()[0])
        days = int(secs // 86400)
        hrs = int((secs % 86400) // 3600)
        mins = int((secs % 3600) // 60)
        result["uptime"] = f"{days}d {hrs}h {mins}m"
        r = subprocess.run(["cat", "/proc/loadavg"], capture_output=True, timeout=5, text=True)
        loads = r.stdout.strip().split()[:3]
        result["load"] = " ".join(loads)
    except:
        pass

    # IP addresses
    try:
        r = subprocess.run(["hostname", "-I"], capture_output=True, timeout=5, text=True)
        result["ips"] = r.stdout.strip().split()
    except:
        pass

    # Connected network devices via ARP
    try:
        r = subprocess.run(["arp", "-a"], capture_output=True, timeout=5, text=True)
        for line in r.stdout.strip().split("\n"):
            m = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\w:]+)", line)
            if m:
                ip = m.group(1)
                mac = m.group(2)
                hostname = ""
                hm = re.search(r"^(\S+)\s+\(", line)
                if hm:
                    hostname = hm.group(1)
                result["net_devices"].append({"ip": ip, "mac": mac, "host": hostname})
    except:
        pass

    return result
```

## Discord Output Format
```
**Raspberry Pi 5 Status**

🟡 Temp: 67.2°C
🟢 Storage: 18G / 28G (66%) — 9.1G free
⏱ Uptime: 86d 13h 5m
📊 Load: 0.00 0.00 0.00
🌐 IPs: 192.168.50.137, ...

**Connected Devices (14):**
  • 192.168.50.214
  • 192.168.50.1 (router)
  ...
```

## Color Indicators
- Temperature: 🟢 <60°C, 🟡 <75°C, 🔴 ≥75°C
- Storage: 🟢 <70%, 🟡 <85%, 🔴 ≥85%

## Data Sources
- Temp: `/sys/class/thermal/thermal_zone0/temp` (millidegrees) or `/opt/vc/bin/vcgencmd measure_temp`
- Storage: `df -h /`
- Uptime: `/proc/uptime`
- Load: `/proc/loadavg`
- IPs: `hostname -I`
- Network devices: `arp -a`
