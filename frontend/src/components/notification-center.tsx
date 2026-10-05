"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Info, X } from "lucide-react";

export type Notice = { id: string; title: string; message: string; tone: "info" | "warning" | "error" };

function Notification({ notice: { id, title, message, tone }, onDismiss }: { notice: Notice; onDismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(6000);
  const dismiss = useRef(onDismiss);
  useEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  const paused = hovered || focused;
  useEffect(() => {
    if (paused || tone === "error") return;
    const started = Date.now();
    const timer = setTimeout(() => dismiss.current(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [id, tone, paused]);
  const Icon = tone === "info" ? Info : AlertCircle;
  return (
    <li className={`notification-toast tone-${tone}`} role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"} aria-atomic="true"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <Icon size={19} aria-hidden="true" />
      <div><strong>{title}</strong><p>{message}</p></div>
      <button type="button" aria-label={`Fechar ${title}`} onClick={() => onDismiss(id)}><X size={17} /></button>
    </li>
  );
}

export function NotificationCenter({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: string) => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = document.createElement("div");
    const place = () => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]');
      const target = [...dialogs].filter(dialog => !dialog.closest('[aria-hidden="true"], [inert], [hidden]')).at(-1) ?? document.body;
      if (container.parentElement !== target) target.appendChild(container);
      if (container.hasAttribute("aria-hidden")) container.removeAttribute("aria-hidden");
    };
    place();
    setHost(container);
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "aria-hidden", "inert", "hidden"] });
    return () => { observer.disconnect(); container.remove(); };
  }, []);
  if (!notices.length) return null;
  const notifications = (
    <section className="notification-center" aria-label="Notificações">
      <ol>{notices.map(notice => <Notification key={`${notice.id}:${notice.tone}:${notice.title}:${notice.message}`} notice={notice} onDismiss={onDismiss} />)}</ol>
    </section>
  );
  return host ? createPortal(notifications, host) : notifications;
}
