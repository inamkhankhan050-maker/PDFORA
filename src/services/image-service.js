import { PRODUCT } from "../config.js";

function sniff(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return null;
}

async function decode(blob) {
  if (globalThis.createImageBitmap) return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let counter = 0;

/** Read a PNG/JPG/WebP/GIF/BMP file into an embeddable asset { id, bytes, format, width, height, url }. */
export async function readImageFile(file) {
  if (!file) throw new Error("Choose an image file.");
  if (file.size > PRODUCT.maxImageBytes) throw new Error(`Images up to ${PRODUCT.maxImageBytes / 1024 / 1024} MB are supported.`);
  let bytes = new Uint8Array(await file.arrayBuffer());
  let format = sniff(bytes);
  let bitmap;
  try {
    bitmap = await decode(new Blob([bytes], { type: file.type || "image/*" }));
  } catch {
    throw new Error("This image couldn't be read. Use PNG, JPG or WebP.");
  }
  const width = bitmap.width;
  const height = bitmap.height;
  if (!format) {
    // WebP, GIF, BMP… are converted losslessly to PNG, keeping transparency.
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("This image couldn't be converted.");
    bytes = new Uint8Array(await blob.arrayBuffer());
    format = "png";
  }
  bitmap.close?.();
  counter += 1;
  return assetFromBytes({ id: `asset-${Date.now().toString(36)}-${counter}`, bytes, format, width, height, name: file.name });
}

export function assetFromBytes(asset) {
  const url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.format === "jpg" ? "image/jpeg" : "image/png" }));
  return { ...asset, url };
}
