export function dataUrlToBlob(dataUrl: string): Blob {
  if (!dataUrl.startsWith("data:")) throw new Error("Invalid recording data URL.");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid recording data URL.");
  const metadata = dataUrl.slice("data:".length, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const metadataParts = metadata.split(";");
  const isBase64 = metadataParts.includes("base64");
  const mimeType = metadataParts.filter((part) => part && part !== "base64").join(";") || "application/octet-stream";
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
