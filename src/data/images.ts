import { uid, type Asset, type AssetGroup } from "../domain/model";
export async function prepareImage(
  file: File,
  projectId: string,
  group: AssetGroup,
  order: number,
): Promise<Asset> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 15 * 1024 * 1024
  )
    throw new Error("Фото: JPG, PNG или WebP до 15 МБ");
  const img = await createImageBitmap(file);
  try {
    if (img.width * img.height > 60000000)
      throw new Error("Изображение больше 60 мегапикселей");
    async function resize(max: number) {
      const ratio = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      canvas
        .getContext("2d")!
        .drawImage(img, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Не удалось обработать фото")),
          "image/webp",
          0.86,
        ),
      );
    }
    return {
      id: uid(),
      projectId,
      group,
      order,
      caption: file.name,
      cover: false,
      blob: file,
      thumb: await resize(480),
    };
  } finally {
    img.close();
  }
}
