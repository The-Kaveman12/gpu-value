// Which technologies each card supports, from vendor + architecture.
// Support status as of October 2026:
//   DLSS 5: RTX 50 only (launched 2026-09-03; RTX 40 promised, not shipped)
//   NVIDIA Smooth Motion: RTX 40 and 50
//   FSR 4 upscaling: RX 9000, and RX 7000 since FSR SDK 2.3 (June 2026)
//   FSR Redstone ML frame gen / Ray Regeneration: RX 9000 only
//   XeSS 3 multi-frame generation: Arc A and B series
// Returns { id: 'Vendor technology name' } for each supported feature id.

import { FEATURES } from '../../site/features.js';

const NVIDIA_RTX_GEN = { Turing: 20, Ampere: 30, 'Ada Lovelace': 40, 'Blackwell 2.0': 50 };
const AMD_RDNA = { 'RDNA 1.0': 1, 'RDNA 2.0': 2, 'RDNA 3.0': 3, 'RDNA 4.0': 4 };
const ARC = new Set(['Xe-HPG', 'Xe2-HPG']);
const NVIDIA_VRR_ARCH = /^(Kepler|Maxwell|Pascal|Volta|Turing|Ampere|Ada|Blackwell)/;
const AMD_VRR_ARCH = /^(GCN [2-5]|RDNA)/; // FreeSync for games needs GCN 1.1 (labelled GCN 2.0 here) or newer
const AMD_VRR_GENERATION = /R[79] 2[6-9]\d|R9 3\d\d|R7 3\d\d|Volcanic Islands|Pirate Islands|Polaris|Vega|Navi/; // entries missing an architecture

export function featuresFor(g) {
  const f = {};
  const add = (id, name) => (f[id] = f[id] ? `${f[id]}, ${name}` : name);
  const arch = g.architecture ?? '';
  const consumer = g.segment === 'desktop';

  if (g.vendor === 'NVIDIA') {
    // GTX 16 cards are Turing without tensor/RT cores, so they get none of the RTX features.
    const rtx = NVIDIA_RTX_GEN[arch] && (g.tensorCores > 0 || /\bRTX\b/.test(g.name)) ? NVIDIA_RTX_GEN[arch] : 0;
    if (rtx >= 20) {
      add('ai-upscaling', 'DLSS Super Resolution');
      add('ai-denoise', 'DLSS Ray Reconstruction');
      if (consumer) add('rtx-hdr', 'RTX HDR');
    }
    if (rtx >= 40) {
      add('frame-gen', 'DLSS Frame Generation');
      add('av1-encode', 'NVENC AV1');
      if (consumer) add('driver-frame-gen', 'Smooth Motion');
    }
    if (rtx >= 50) {
      add('multi-frame-gen', 'DLSS Multi Frame Generation');
      if (consumer) add('dlss5', 'DLSS 5');
    }
    if (NVIDIA_VRR_ARCH.test(arch) && (arch !== 'Kepler' || /GTX|TITAN/.test(g.name))) add('vrr', 'G-SYNC / G-SYNC Compatible');
  }

  if (g.vendor === 'AMD') {
    const rdna = AMD_RDNA[arch] ?? 0;
    if (rdna >= 3) add('ai-upscaling', 'FSR 4');
    if (rdna >= 1) add('frame-gen', rdna >= 4 ? 'FSR ML Frame Generation' : 'FSR 3 Frame Generation');
    if (rdna >= 2 && consumer) add('driver-frame-gen', 'AMD Fluid Motion Frames');
    if (rdna >= 3) add('av1-encode', 'AMF AV1');
    if (rdna >= 4) add('ai-denoise', 'FSR Ray Regeneration');
    if (AMD_VRR_ARCH.test(arch) || (!arch && AMD_VRR_GENERATION.test(`${g.name} ${g.generation ?? ''}`))) add('vrr', 'FreeSync');
  }

  if (g.vendor === 'Intel' && ARC.has(arch)) {
    add('ai-upscaling', 'XeSS (XMX)');
    add('frame-gen', 'XeSS Frame Generation');
    add('multi-frame-gen', 'XeSS 3 Multi-Frame Generation');
    add('av1-encode', 'QSV AV1');
    add('vrr', 'Adaptive-Sync (FreeSync / G-SYNC Compatible monitors)');
  }

  if (g.directX === '12.2') add('hw-rt', 'DirectX 12 Ultimate');

  for (const id of Object.keys(f)) if (!FEATURES.some((x) => x.id === id)) throw new Error(`Unknown feature id ${id}`);
  return f;
}
