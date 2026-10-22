// Technology filters shown in the page. Which cards support each one is
// decided at build time by scripts/lib/features.js (support as of Oct 2026).

export const FEATURE_GROUPS = [
  {
    title: 'Upscaling',
    items: [
      { id: 'ai-upscaling', label: 'AI upscaling', hint: 'DLSS (RTX 20+), FSR 4 (RX 7000 / 9000), XeSS XMX (Arc)' },
    ],
  },
  {
    title: 'Frame generation',
    items: [
      { id: 'frame-gen', label: 'Frame generation', hint: 'DLSS FG (RTX 40+), FSR FG (RX 5000+), XeSS FG (Arc). FSR FG also runs on many other cards in supported games.' },
      { id: 'multi-frame-gen', label: 'Multi-frame generation (3×+)', hint: 'DLSS 4 MFG (RTX 50), XeSS 3 MFG (Arc)' },
      { id: 'driver-frame-gen', label: 'Frame generation in any game', hint: 'Driver-level: AMD Fluid Motion Frames (RX 6000+), NVIDIA Smooth Motion (RTX 40+)' },
    ],
  },
  {
    title: 'Ray tracing & neural rendering',
    items: [
      { id: 'dlss5', label: 'DLSS 5', hint: 'Neural rendering, RTX 50 only (RTX 40 support promised but not out yet)' },
      { id: 'hw-rt', label: 'Hardware ray tracing', hint: 'DirectX 12 Ultimate (RTX 20+, RX 6000+, Arc)' },
      { id: 'ai-denoise', label: 'AI ray-tracing denoiser', hint: 'DLSS Ray Reconstruction (RTX 20+), FSR Ray Regeneration (RX 9000)' },
    ],
  },
  {
    title: 'Display & streaming',
    items: [
      { id: 'vrr', label: 'FreeSync / G-SYNC', hint: 'Variable refresh rate with a compatible monitor' },
      { id: 'rtx-hdr', label: 'RTX HDR', hint: 'AI HDR for SDR games and video (GeForce RTX 20+)' },
      { id: 'av1-encode', label: 'AV1 encoding', hint: 'Hardware AV1 for streaming and recording (RTX 40+, RX 7000+, Arc)' },
    ],
  },
];

export const FEATURES = FEATURE_GROUPS.flatMap((g) => g.items);
