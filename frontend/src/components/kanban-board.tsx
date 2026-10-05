"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import {
  activeLane,
  laneScrollTarget,
  mirrorScroll,
  stepLane,
} from "@/lib/board";
import type { Task } from "@/lib/mission";

export type BoardColumn = { id: string; label: string; tasks: Task[] };

/** Kanban with equal-height columns. Each column scrolls vertically on its own, so a lane with
 * dozens of cards never stretches the page, and the horizontal scrollbar sits ABOVE the board
 * (a mirrored rail) next to chips and arrows that jump to a column. */
export function KanbanBoard({
  columns,
  listMode,
  renderCard,
}: {
  columns: BoardColumn[];
  listMode: boolean;
  renderCard: (task: Task) => ReactNode;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number>();
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);
  const [active, setActive] = useState(0);

  const offsets = useCallback(
    () =>
      Array.from(
        boardRef.current?.querySelectorAll<HTMLElement>(":scope > section") ??
          [],
      ).map((column) => column.offsetLeft),
    [],
  );
  const maxScroll = () => {
    const board = boardRef.current;
    return board ? board.scrollWidth - board.clientWidth : 0;
  };
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    setBoardHeight(Math.max(400, window.innerHeight - board.getBoundingClientRect().top - window.scrollY - 24));
    setScrollWidth(board.scrollWidth);
    setOverflowing(board.scrollWidth > board.clientWidth + 1);
    setActive(activeLane(offsets(), board.scrollLeft, maxScroll()));
  }, [offsets]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || listMode) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    observer.observe(board.closest("main") ?? board);
    const topbar = board.closest(".main-shell")?.querySelector(".topbar");
    if (topbar) observer.observe(topbar);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, listMode, columns.length]);

  const goTo = (index: number) => {
    const board = boardRef.current;
    if (!board) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    board.scrollTo({
      left: laneScrollTarget(offsets(), index, maxScroll()),
      behavior: reduced ? "auto" : "smooth",
    });
  };
  const onBoardScroll = () => {
    const board = boardRef.current;
    if (!board) return;
    if (railRef.current) mirrorScroll(board, railRef.current);
    setActive(activeLane(offsets(), board.scrollLeft, maxScroll()));
  };
  const onRailScroll = () => {
    if (boardRef.current && railRef.current)
      mirrorScroll(railRef.current, boardRef.current);
  };
  // Arrow keys move between columns only while the board itself has focus, never inside a card.
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const next =
      event.key === "ArrowRight"
        ? stepLane(active, 1, columns.length)
        : event.key === "ArrowLeft"
          ? stepLane(active, -1, columns.length)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? columns.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    goTo(next);
  };

  const body = (column: BoardColumn) => (
    <section
      className={`kanban-column lane-${column.id}`}
      key={column.id}
      data-lane={column.id}
    >
      <header>
        <span className={`lane-dot lane-${column.id}`} />
        <h2>{column.label}</h2>
        <span>{column.tasks.length}</span>
      </header>
      <div role="region" aria-label={`${column.label} · missões`} tabIndex={0}>
        {column.tasks.map(renderCard)}
        {!column.tasks.length && (
          <div className="lane-empty-box">
            <div className="lane-empty-icon-wrap">
              <Inbox size={20} />
            </div>
            <p className="lane-empty-title">Nenhuma missão nesta etapa</p>
            <span className="lane-empty-desc">Fila limpa e pronta para admissão</span>
          </div>
        )}
      </div>
    </section>
  );

  if (listMode)
    return (
      <div className="kanban list-mode" aria-label="Quadro de missões" tabIndex={0}>
        {columns.map(body)}
      </div>
    );

  return (
    <div className="kanban-shell" style={boardHeight ? { "--board-h": `${boardHeight}px` } as CSSProperties : undefined}>
      <div className="kanban-nav" role="group" aria-label="Navegar entre etapas">
        <span className="kanban-nav-hint" id="kanban-scroll-help">Role para ver concluídas e bloqueadas</span>
        <button
          type="button"
          className="kanban-step"
          aria-label="Etapa anterior"
          disabled={active <= 0}
          onClick={() => goTo(stepLane(active, -1, columns.length))}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          className="kanban-step"
          aria-label="Próxima etapa"
          disabled={active >= columns.length - 1}
          onClick={() => goTo(stepLane(active, 1, columns.length))}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <div
        className="kanban-rail"
        hidden={!overflowing}
        ref={railRef}
        onScroll={onRailScroll}
        aria-hidden="true"
        tabIndex={-1}
      >
        <div style={{ width: scrollWidth }} />
      </div>
      <div
        className="kanban"
        ref={boardRef}
        onScroll={onBoardScroll}
        onKeyDown={onKey}
        role="region"
        aria-describedby="kanban-scroll-help"
        aria-label="Quadro de missões"
        tabIndex={0}
      >
        {columns.map(body)}
      </div>
    </div>
  );
}
