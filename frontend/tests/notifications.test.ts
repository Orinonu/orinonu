import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationCenter } from "../src/components/notification-center.tsx";

test("floating notifications distinguish updates from errors and can be dismissed", () => {
  const html = renderToStaticMarkup(createElement(NotificationCenter, {
    notices: [
      { id: "saved", title: "Atualização", message: "Missão salva.", tone: "info" },
      { id: "failed", title: "Operação não concluída", message: "Servidor indisponível.", tone: "error" },
    ],
    onDismiss: () => {},
  }));
  assert.match(html, /aria-label="Notificações"/);
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.equal([...html.matchAll(/aria-label="Notificações"/g)].length, 1);
  assert.match(html, /Missão salva\./);
  assert.match(html, /Servidor indisponível\./);
  assert.match(html, /aria-label="Fechar Atualização"/);
  assert.match(html, /aria-label="Fechar Operação não concluída"/);
});
