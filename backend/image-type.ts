export function imageType(bytes: Uint8Array) {
  const text = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes[0] === 137 && text(1, 3) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
  return null;
}
