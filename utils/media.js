const sharp = require('sharp');

async function createStickerFromImage(imageBuffer) {
    return await sharp(imageBuffer)
        .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp()
        .toBuffer();
}

module.exports = { createStickerFromImage };
