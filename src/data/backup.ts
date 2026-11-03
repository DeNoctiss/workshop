import { migrateState } from "../domain/migrations";
import { validateBoardAssets } from "../domain/workspaceValidation";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { State, Asset } from "../domain/model";
import { validate, validateAssets } from "../domain/validation";
export async function encodeBackup(state: State, assets: Asset[]) {
  validate(state);
  validateAssets(state, assets);
  validateBoardAssets(state, assets);
  const files: Record<string, Uint8Array> = {};
  const metadata = [];
  for (const a of assets) {
    const { blob, thumb, ...rest } = a;
    const path = `images/${a.projectId}/${a.id}`;
    files[path + ".image"] = new Uint8Array(await blob.arrayBuffer());
    files[path + ".thumb"] = new Uint8Array(await thumb.arrayBuffer());
    metadata.push({ ...rest, path, mime: blob.type, thumbMime: thumb.type });
  }
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "masterskaya",
      version: 3,
      schemaVersion: 3,
      createdAt: new Date().toISOString(),
      images: assets.length,
    }),
  );
  files["data.json"] = strToU8(JSON.stringify({ state, assets: metadata }));
  return zipSync(files, { level: 6 });
}
export function decodeBackup(bytes: Uint8Array): {
  state: State;
  assets: Asset[];
} {
  if (bytes.length > 150 * 1024 * 1024) throw new Error("ZIP больше 150 МБ");
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      size += f.originalSize;
      if (
        size > 300 * 1024 * 1024 ||
        f.name.includes("..") ||
        f.name.startsWith("/")
      )
        throw new Error("Недопустимый размер или путь ZIP");
      return true;
    },
  });
  if (!files["manifest.json"] || !files["data.json"])
    throw new Error("Это не резервная копия Мастерской");
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  if (
    manifest.format !== "masterskaya" ||
    ![1, 2, 3].includes(manifest.version)
  )
    throw new Error("Неподдерживаемая версия ZIP");
  const data = JSON.parse(strFromU8(files["data.json"]));
  if (!Array.isArray(data.assets) || manifest.images !== data.assets.length)
    throw new Error("Неверный список изображений");
  const assets: Asset[] = data.assets.map((a: any) => {
    const { path, mime, thumbMime, ...rest } = a;
    if (
      path !== `images/${a.projectId}/${a.id}` ||
      !files[path + ".image"] ||
      !files[path + ".thumb"]
    )
      throw new Error("В ZIP отсутствуют изображения");
    return {
      ...rest,
      blob: new Blob([files[path + ".image"].slice().buffer], { type: mime }),
      thumb: new Blob([files[path + ".thumb"].slice().buffer], {
        type: thumbMime,
      }),
    };
  });
  const state = migrateState(data.state, assets);
  validate(state);
  validateAssets(state, assets);
  validateBoardAssets(state, assets);
  return { state, assets };
}
export function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
