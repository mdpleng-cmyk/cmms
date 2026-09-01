// assetGlyphs.js
// One small SVG schematic per equipment category. New assets in an
// existing category need zero extra work — only a genuinely new
// category needs a new entry here. Colors use currentColor / var(--border)
// etc. so they follow your existing theme automatically.

export const ASSET_GLYPHS = {

  heat_exchanger: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="30" y="14" width="80" height="92" rx="3" fill="var(--panel-raised)" stroke="var(--border)"/>
      <line x1="38" y1="14" x2="38" y2="106" stroke="var(--border)"/>
      <line x1="102" y1="14" x2="102" y2="106" stroke="var(--border)"/>
      <g stroke="#71717a" stroke-width="1.6" opacity="0.6">
        <line x1="46" y1="24" x2="94" y2="24"/><line x1="46" y1="34" x2="94" y2="34"/>
        <line x1="46" y1="44" x2="94" y2="44"/><line x1="46" y1="54" x2="94" y2="54"/>
        <line x1="46" y1="64" x2="94" y2="64"/><line x1="46" y1="74" x2="94" y2="74"/>
        <line x1="46" y1="84" x2="94" y2="84"/><line x1="46" y1="94" x2="94" y2="94"/>
      </g>
      <rect x="20" y="4" width="18" height="14" rx="2" fill="var(--border)"/>
      <rect x="102" y="4" width="18" height="14" rx="2" fill="var(--border)"/>
      <rect x="20" y="102" width="18" height="14" rx="2" fill="var(--border)"/>
      <rect x="102" y="102" width="18" height="14" rx="2" fill="var(--border)"/>
    </svg>`,

  boiler: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="42" y="20" width="56" height="80" rx="10" fill="var(--panel-raised)" stroke="var(--border)"/>
      <circle cx="70" cy="34" r="5" fill="none" stroke="#71717a" stroke-width="1.6"/>
      <line x1="70" y1="46" x2="70" y2="94" stroke="#71717a" stroke-width="1.6" stroke-dasharray="3 4"/>
      <rect x="60" y="8" width="20" height="12" rx="2" fill="var(--border)"/>
      <rect x="30" y="60" width="12" height="10" rx="2" fill="var(--border)"/>
      <rect x="98" y="60" width="12" height="10" rx="2" fill="var(--border)"/>
    </svg>`,

  pump: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <circle cx="70" cy="60" r="30" fill="var(--panel-raised)" stroke="var(--border)"/>
      <circle cx="70" cy="60" r="10" fill="none" stroke="#71717a" stroke-width="1.6"/>
      <line x1="70" y1="60" x2="70" y2="38" stroke="#71717a" stroke-width="1.6"/>
      <line x1="70" y1="60" x2="86" y2="68" stroke="#71717a" stroke-width="1.6"/>
      <rect x="4" y="52" width="26" height="16" rx="2" fill="var(--border)"/>
      <rect x="110" y="52" width="26" height="16" rx="2" fill="var(--border)"/>
    </svg>`,

  tank: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="34" y="18" width="72" height="86" rx="6" fill="var(--panel-raised)" stroke="var(--border)"/>
      <line x1="34" y1="46" x2="106" y2="46" stroke="#71717a" stroke-width="1.2" opacity="0.6"/>
      <line x1="34" y1="72" x2="106" y2="72" stroke="#71717a" stroke-width="1.2" opacity="0.6"/>
      <rect x="60" y="4" width="20" height="14" rx="2" fill="var(--border)"/>
      <rect x="24" y="94" width="14" height="12" rx="2" fill="var(--border)"/>
    </svg>`,

  silo: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="44" y="10" width="52" height="70" fill="var(--panel-raised)" stroke="var(--border)"/>
      <path d="M44 80 L70 108 L96 80 Z" fill="var(--panel-raised)" stroke="var(--border)"/>
      <line x1="44" y1="34" x2="96" y2="34" stroke="#71717a" stroke-width="1.2" opacity="0.6"/>
      <line x1="44" y1="58" x2="96" y2="58" stroke="#71717a" stroke-width="1.2" opacity="0.6"/>
    </svg>`,

  valve_skid: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <line x1="14" y1="60" x2="126" y2="60" stroke="var(--border)" stroke-width="6"/>
      <circle cx="70" cy="60" r="16" fill="var(--panel-raised)" stroke="#71717a" stroke-width="1.6"/>
      <line x1="60" y1="50" x2="80" y2="70" stroke="#71717a" stroke-width="1.6"/>
      <line x1="80" y1="50" x2="60" y2="70" stroke="#71717a" stroke-width="1.6"/>
      <rect x="64" y="30" width="12" height="14" rx="2" fill="var(--border)"/>
    </svg>`,

  compressor: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="24" y="40" width="92" height="40" rx="6" fill="var(--panel-raised)" stroke="var(--border)"/>
      <circle cx="46" cy="60" r="10" fill="none" stroke="#71717a" stroke-width="1.6"/>
      <circle cx="94" cy="60" r="10" fill="none" stroke="#71717a" stroke-width="1.6"/>
      <line x1="56" y1="60" x2="84" y2="60" stroke="#71717a" stroke-width="1.6"/>
      <rect x="30" y="86" width="14" height="12" rx="2" fill="var(--border)"/>
      <rect x="96" y="86" width="14" height="12" rx="2" fill="var(--border)"/>
    </svg>`,

  default: `
    <svg width="140" height="120" viewBox="0 0 140 120" fill="none">
      <rect x="36" y="24" width="68" height="68" rx="6" fill="var(--panel-raised)" stroke="var(--border)"/>
      <circle cx="70" cy="58" r="14" fill="none" stroke="#71717a" stroke-width="1.6"/>
      <line x1="70" y1="44" x2="70" y2="34" stroke="#71717a" stroke-width="1.6"/>
      <line x1="70" y1="72" x2="70" y2="82" stroke="#71717a" stroke-width="1.6"/>
    </svg>`,
};

export function renderAssetGlyph(category) {
  return ASSET_GLYPHS[category] || ASSET_GLYPHS.default;
}
