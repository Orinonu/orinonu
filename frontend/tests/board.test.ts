import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KanbanBoard } from "../src/components/kanban-board.tsx";
import {
  activeLane,
  laneScrollTarget,
  mirrorScroll,
  stepLane,
} from "../src/lib/board";

test("the board keeps all six stages without duplicating them as navigation buttons", () => {
  const html = renderToStaticMarkup(createElement(KanbanBoard, {
    columns: [
      { id: "backlog", label: "Fila", tasks: [] },
      { id: "planning", label: "Planejamento", tasks: [] },
      { id: "running", label: "Implementação", tasks: [] },
      { id: "review", label: "Revisão", tasks: [] },
      { id: "done", label: "Concluídas", tasks: [] },
      { id: "blocked", label: "Bloqueadas", tasks: [] },
    ],
    listMode: false,
    renderCard: () => null,
  }));
  assert.deepEqual([...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((match) => match[1]),
    ["Fila", "Planejamento", "Implementação", "Revisão", "Concluídas", "Bloqueadas"]);
  assert.doesNotMatch(html, /class="kanban-chip /);
});

const offsets = [0, 315, 630, 945, 1260, 1575];

test("laneScrollTarget leads to the column start and clamps to the scrollable range", () => {
  assert.equal(laneScrollTarget(offsets, 0, 1000), 0);
  assert.equal(laneScrollTarget(offsets, 2, 1000), 630);
  // The last columns cannot start at the viewport edge: the board stops scrolling first.
  assert.equal(laneScrollTarget(offsets, 5, 1000), 1000);
  assert.equal(laneScrollTarget(offsets, 99, 1000), 1000);
  assert.equal(laneScrollTarget(offsets, -3, 1000), 0);
  assert.equal(laneScrollTarget([], 0, 0), 0);
});

test("activeLane follows the column nearest to the left edge", () => {
  assert.equal(activeLane(offsets, 0, 1000), 0);
  assert.equal(activeLane(offsets, 150, 1000), 0);
  assert.equal(activeLane(offsets, 170, 1000), 1);
  assert.equal(activeLane(offsets, 640, 1000), 2);
  // At the end of the board the last column is the active one even if it cannot align.
  assert.equal(activeLane(offsets, 1000, 1000), 5);
  assert.equal(activeLane([], 0, 0), 0);
});

test("stepLane moves one column and never leaves the board", () => {
  assert.equal(stepLane(0, -1, 6), 0);
  assert.equal(stepLane(0, 1, 6), 1);
  assert.equal(stepLane(5, 1, 6), 5);
  assert.equal(stepLane(3, -1, 6), 2);
  assert.equal(stepLane(0, 1, 0), 0);
});

test("mirrorScroll copies the position without echoing tiny differences", () => {
  const source = { scrollLeft: 420 };
  const target = { scrollLeft: 0 };
  assert.equal(mirrorScroll(source, target), true);
  assert.equal(target.scrollLeft, 420);
  // Already aligned (sub-pixel rounding): no write, so the two scrollers cannot ping-pong.
  target.scrollLeft = 419.6;
  assert.equal(mirrorScroll(source, target), false);
  assert.equal(target.scrollLeft, 419.6);
});
