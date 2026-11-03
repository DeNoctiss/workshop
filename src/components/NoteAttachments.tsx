import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import { ImagePlus, X, ArrowLeft, ArrowRight } from "lucide-react";
import type { Asset, AssetMeta } from "../domain/model";
import { useApp } from "./context";
import { Modal, Photo } from "./ui";
import { errorText } from "../data/db";
import { prepareImage } from "../data/images";
export function AttachmentGallery({ ids }: { ids: string[] }) {
  const { assets } = useApp();
  const photos = ids
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetMeta => !!a);
  const [index, setIndex] = useState<number | null>(null);
  return (
    <>
      <div className="attachment-gallery">
        {photos.map((a, i) => (
          <button
            key={a.id}
            type="button"
            aria-label={"Открыть фото: " + a.caption}
            onClick={() => setIndex(i)}
          >
            <Photo asset={a} />
          </button>
        ))}
      </div>
      {index !== null && photos[index] && (
        <Modal
          wide
          title={photos[index].caption}
          onClose={() => setIndex(null)}
        >
          <div className="attachment-lightbox">
            <Photo asset={photos[index]} full />
          </div>
          {photos.length > 1 && (
            <div className="attachment-navigation">
              <button
                onClick={() =>
                  setIndex((index + photos.length - 1) % photos.length)
                }
              >
                <ArrowLeft size={16} />
                Предыдущее
              </button>
              <span>
                {index + 1} / {photos.length}
              </span>
              <button onClick={() => setIndex((index + 1) % photos.length)}>
                Следующее
                <ArrowRight size={16} />
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
function DraftPhoto({ file }: { file: Asset }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(file.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return <img src={url} alt={file.caption} />;
}
export function AttachmentDraft({
  ids,
  files,
  remove,
}: {
  ids: string[];
  files: Asset[];
  remove: (id: string) => void;
}) {
  const { assets } = useApp();
  return (
    <div className="attachment-gallery draft">
      {ids.map((id) => {
        const file = files.find((a) => a.id === id),
          meta = assets.find((a) => a.id === id);
        return (
          <div key={id}>
            {file ? (
              <DraftPhoto file={file} />
            ) : meta ? (
              <Photo asset={meta} />
            ) : null}
            <button
              type="button"
              className="icon"
              aria-label="Убрать вложение"
              onClick={() => remove(id)}
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
export function useNoteUploads(
  projectId: string,
  append: (files: Asset[]) => void,
  remaining: number,
) {
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false);
  const add = async (files: File[]) => {
    if (!files.length || inFlight.current) return;
    inFlight.current = true;
    setPreparing(true);
    setError("");
    try {
      if (files.length > remaining)
        throw new Error("В заметке может быть до 20 фотографий.");
      const prepared = await Promise.all(
        files.map((f, i) => prepareImage(f, projectId, "process", i)),
      );
      append(prepared.map((a) => ({ ...a, purpose: "note" })));
    } catch (e) {
      setError(errorText(e));
    } finally {
      inFlight.current = false;
      setPreparing(false);
    }
  };
  const paste = (e: ClipboardEvent) => {
    const images = Array.from(e.clipboardData.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (images.length) {
      e.preventDefault();
      void add(images);
    }
  };
  return {
    preparing,
    error,
    paste,
    input: (
      <label className="button">
        <ImagePlus size={18} />
        {preparing ? "Обработка фото…" : "Прикрепить фото"}
        <input
          className="file-input"
          disabled={preparing || remaining <= 0}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = Array.from(e.target.files ?? []);
            e.target.value = "";
            void add(f);
          }}
        />
      </label>
    ),
  };
}
