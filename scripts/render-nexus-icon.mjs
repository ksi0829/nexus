import path from "node:path";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(projectRoot, "public/nexus-icon-source.png");
const icon512 = path.join(projectRoot, "public/nexus-icon-512.png");

const trimmed = await sharp(source)
  .trim({
    background: "#ffffff",
    threshold: 12,
  })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([
    {
      input: await sharp(trimmed)
        .resize(508, 508, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer(),
      gravity: "centre",
    },
  ])
  .png()
  .toFile(icon512);

const iconSizes = [16, 24, 32, 48, 64, 128, 256];
const iconImages = await Promise.all(
  iconSizes.map((size) =>
    sharp(icon512)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer()
  )
);

const directorySize = 6 + iconImages.length * 16;
let imageOffset = directorySize;
const icoHeader = Buffer.alloc(directorySize);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(iconImages.length, 4);

iconImages.forEach((image, index) => {
  const size = iconSizes[index];
  const entryOffset = 6 + index * 16;
  icoHeader.writeUInt8(size === 256 ? 0 : size, entryOffset);
  icoHeader.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  icoHeader.writeUInt8(0, entryOffset + 2);
  icoHeader.writeUInt8(0, entryOffset + 3);
  icoHeader.writeUInt16LE(1, entryOffset + 4);
  icoHeader.writeUInt16LE(32, entryOffset + 6);
  icoHeader.writeUInt32LE(image.length, entryOffset + 8);
  icoHeader.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += image.length;
});

await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(
    path.join(projectRoot, "public/nexus.ico"),
    Buffer.concat([icoHeader, ...iconImages])
  )
);

await sharp(icon512)
  .resize(192, 192, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .png()
  .toFile(path.join(projectRoot, "public/nexus-icon-192.png"));

await sharp(icon512)
  .png()
  .toFile(path.join(projectRoot, "public/nexus-icon-v2-512.png"));

await sharp(icon512)
  .resize(192, 192, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    kernel: sharp.kernel.lanczos3,
  })
  .png()
  .toFile(path.join(projectRoot, "public/nexus-icon-v2-192.png"));

await sharp(icon512)
  .png()
  .toFile(path.join(projectRoot, "app/icon.png"));

await sharp(icon512)
  .png()
  .toFile(path.join(projectRoot, "app/apple-icon.png"));

await sharp(icon512)
  .png()
  .toFile(path.join(projectRoot, "public/nexus-symbol.png"));
