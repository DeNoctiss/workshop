import { Paged } from "../components/Paged";
import { useState } from "react";
import { Upload, Trash2, ArrowLeft, ArrowRight } from "lucide-react";
import { useApp } from "../components/context";
import { Photo, Modal } from "../components/ui";
import { assetGroups, type AssetGroup, type AssetMeta } from "../domain/model";
import { prepareImage } from "../data/images";
import { saveAssets, removeAsset, updateAssetMeta } from "../data/db";
export function Gallery({ projectId }: { projectId: string }) {
  const { assets, act, confirm } = useApp();
  const [group, setGroup] = useState<AssetGroup>("main"),
    [full, setFull] = useState<AssetMeta | null>(null);
  const items = assets
    .filter(
      (a) => a.projectId === projectId && !a.purpose?.startsWith("paint-"),
    )
    .sort((a, b) => a.order - b.order);
  async function move(a: AssetMeta, d: number) {
    const index = items.findIndex((x) => x.id === a.id),
      other = items[index + d];
    if (!other) return;
    await act(
      () =>
        Promise.all([
          updateAssetMeta(a.id, { order: other.order }),
          updateAssetMeta(other.id, { order: a.order }),
        ]),
      "Порядок обновлён",
    );
  }
  return (
    <section className="panel gallery">
      <div className="section-head">
        <div>
          <h2>Фотографии и референсы</h2>
          <p>Хранятся на этом устройстве и включаются в ZIP-копию.</p>
        </div>
        <div className="actions">
          <select
            aria-label="Категория загрузки"
            value={group}
            onChange={(e) => setGroup(e.target.value as AssetGroup)}
          >
            {Object.entries(assetGroups).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="button primary">
            <Upload size={17} />
            Добавить фото
            <input
              className="file-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                void act(async () => {
                  const prepared = [];
                  for (let i = 0; i < files.length; i++)
                    prepared.push(
                      await prepareImage(
                        files[i],
                        projectId,
                        group,
                        (items.at(-1)?.order ?? -1) + 1 + i,
                      ),
                    );
                  await saveAssets(prepared);
                }, "Фотографии добавлены");
              }}
            />
          </label>
        </div>
      </div>
      {!items.length && (
        <p className="muted">
          Добавьте снимки человека, ракурсы модели и фотографии готовой фигурки.
          JPG, PNG, WebP до 15 МБ.
        </p>
      )}
      {Object.entries(assetGroups).map(([key, title]) => {
        const photos = items.filter((a) => a.group === key);
        return photos.length ? (
          <section key={key}>
            <h3>{title}</h3>
            <Paged className="photo-grid">
              {photos.map((a) => (
                <article className="photo-card" key={a.id}>
                  <button className="photo-open" onClick={() => setFull(a)}>
                    <Photo asset={a} />
                  </button>
                  <input
                    aria-label="Подпись фото"
                    defaultValue={a.caption}
                    onBlur={(e) => {
                      if (e.target.value !== a.caption)
                        void act(() =>
                          updateAssetMeta(a.id, { caption: e.target.value }),
                        );
                    }}
                  />
                  <select
                    aria-label="Категория фото"
                    value={a.group}
                    onChange={(e) =>
                      void act(() =>
                        updateAssetMeta(a.id, {
                          group: e.target.value as AssetGroup,
                        }),
                      )
                    }
                  >
                    {Object.entries(assetGroups).map(([k, v]) => (
                      <option value={k} key={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={a.cover}
                      onChange={(e) =>
                        void act(() =>
                          updateAssetMeta(a.id, { cover: e.target.checked }),
                        )
                      }
                    />
                    Обложка каталога
                  </label>
                  <div className="actions">
                    <button
                      className="icon"
                      aria-label="Фото раньше"
                      onClick={() => void move(a, -1)}
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <button
                      className="icon"
                      aria-label="Фото позже"
                      onClick={() => void move(a, 1)}
                    >
                      <ArrowRight size={16} />
                    </button>
                    <button
                      className="icon danger-text"
                      aria-label="Удалить фото"
                      onClick={() =>
                        confirm(
                          "Удалить фотографию?",
                          "Сохранённая ZIP-копия позволит восстановить её.",
                          () => removeAsset(a.id),
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </Paged>
          </section>
        ) : null;
      })}
      {full && (
        <Modal title={full.caption} onClose={() => setFull(null)} wide>
          <div className="full-photo">
            <Photo asset={full} full />
          </div>
        </Modal>
      )}
    </section>
  );
}
