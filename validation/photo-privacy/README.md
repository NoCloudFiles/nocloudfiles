# Photo privacy release checks

The fixtures contain synthetic content and fabricated metadata.

- `private-original.jpg` is the existing synthetic JPEG re-encoded with Pillow, orientation 6, fictional author and GPS tags.
- `private-original.heic` is the JPEG converted with libheif's heif-enc (including its rotation and EXIF item).
- `motion.jpg` adds a Google MicroVideo XMP packet with a video offset and an appended playable MP4 of a solid red frame sequence.
- `gain-map.jpg` was encoded with Google's libultrahdr CLI from a synthetic 64×64 RGBA1010102 buffer. The file includes a second JPEG and ISO gain-map metadata.

The browser tests select local files through the published UI, download the result and parse it. Coverage includes removal of GPS, author, motion payload and gain map, displayed orientation, edited XMP, no HTTP writes with analytics off, the bounded analytics funnel and both homepage source links. Tests use Chromium and WebKit iPhone emulation. They do not cover all manufacturer-specific HEIF profiles or substitute for physical-device testing.

The live probe uses a synthetic HEIC and explicitly opts into GA. Its file-source events are QA traffic. Only a bounded subset of network parameters is saved in live-wire.json.

Production Worker 5018597f-5334-48eb-b9c2-d1439e0f7b29, 2026-11-21. Local tests: 29 Node and 54 Chromium/WebKit checks passed. Production checks passed for both languages' homepage links and the four fixture workflows on both browsers. The first cold Chromium HEIC check exceeded the local 8-second assertion timeout; the focused online retry finished in 17.3 seconds with a 30-second decoder-load allowance. First-use HEIC latency depends on downloading the decoder.

A separate production HEIC download was opened with Pillow and its XMP parsed with Python ElementTree. It was an upright 240×180 JPEG with empty EXIF and a single requested synthetic author value. The production GA probe received 204s for page_view, tool_start, photo_inspected, photo_ready and download_click, and no pre-consent Google requests. The realtime report in NoCloudFiles property 565307803 independently displayed the Photo privacy check page and both new event names after the native Chrome workflow.
