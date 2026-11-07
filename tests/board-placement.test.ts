import { describe, expect, it } from "vitest";
import { createNode, findFreePosition } from "../src/board/operations";

describe("размещение карточек доски", () => {
  const note = (x: number, y: number) =>
    createNode({ kind: "note" as const, title: "Заметка", text: "" }, { x, y });

  it("оставляет свободную точку без изменения существующих узлов", () => {
    const first = note(100, 100);
    const before = structuredClone(first);
    expect(
      findFreePosition(
        [first],
        { x: 500, y: 100 },
        { width: 280, height: 260 },
      ),
    ).toEqual({ x: 500, y: 100 });
    expect(first).toEqual(before);
  });

  it("разводит повторные добавления и учитывает размеры карточки", () => {
    const first = note(100, 100);
    const second = findFreePosition(
      [first],
      { x: 100, y: 100 },
      { width: 280, height: 260 },
    );
    expect(second).toEqual({ x: 400, y: 100 });
    const third = findFreePosition(
      [first, note(second.x, second.y)],
      { x: 100, y: 100 },
      { width: 280, height: 260 },
    );
    expect(third).toEqual({ x: 100, y: 380 });
  });

  it("учитывает мировую позицию дочерней карточки и размер группы", () => {
    const group = createNode(
      { kind: "group", title: "Группа" },
      { x: 100, y: 100 },
    );
    const child = note(20, 60);
    child.parentId = group.id;
    const position = findFreePosition(
      [group, child],
      { x: 120, y: 160 },
      { width: 280, height: 260 },
    );
    expect(
      position.x >= 100 + 580 + 20 ||
        position.y >= 100 + 420 + 20 ||
        position.x + 280 + 20 <= 100 ||
        position.y + 260 + 20 <= 100,
    ).toBe(true);
  });
});
