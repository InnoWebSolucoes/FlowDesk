// Renders public/logo.svg — the FlowDesk mark, a rounded square in the brand
// green with a white "F", the same mark as the sidebar and the browser tab —
// into build/icon.ico (multi-resolution) for electron-builder.
// Run with: npm run icon
const sharp = require('sharp')
const pngToIco = require('png-to-ico').default
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', '..', 'public', 'logo.svg')
const OUT_DIR = __dirname
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const svg = fs.readFileSync(SRC)
  const pngs = []
  for (const size of SIZES) {
    // resize() pins the output to exactly `size`: sharp's SVG rasteriser scales
    // by density, which would otherwise emit larger tiles and bloat the ico.
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
    pngs.push(buf)
  }
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), await pngToIco(pngs))

  // macOS builds icon.png into an .icns and rejects anything under 512px, so
  // it gets its own render rather than reusing one of the .ico sizes.
  const mac = await sharp(svg, { density: 512 }).resize(1024, 1024).png().toBuffer()
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), mac)
  console.log('wrote build/icon.ico (multi-size) and build/icon.png (1024px, for macOS)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
