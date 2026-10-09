import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// The source SVG is already full-bleed with the glyph inside the maskable safe zone,
// so no extra padding is added. Run `npm run icons` after changing public/logo.svg.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0 },
    apple: { ...minimal2023Preset.apple, padding: 0 },
  },
  images: ['public/logo.svg'],
})
