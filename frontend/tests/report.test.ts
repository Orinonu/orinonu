import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportContent } from "../src/components/report-content.tsx";

const render = (content: string) => renderToStaticMarkup(createElement(ReportContent, { content }));

test("report references keep their destination visible and require explicit external navigation", () => {
  const html = render("[Evidência](https://example.org/evidence?q=one&source=report) e <https://example.org/raw>.");
  assert.match(html, /href="https:\/\/example\.org\/evidence\?q=one&amp;source=report"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.match(html, />https:\/\/example\.org\/evidence\?q=one&amp;source=report</);
  assert.match(html, /nova aba/);
  assert.match(html, /href="https:\/\/example\.org\/raw"/);
});

test("untrusted protocols and relative references remain text, never navigable URLs", () => {
  for (const destination of ["javascript:alert%281%29", "data:text/html;base64,PHNjcmlwdD4=", "file:///private/report", "//example.org/report", "/api/tasks", "mailto:person@example.org"]) {
    const html = render(`[Fonte](${destination})`);
    assert.doesNotMatch(html, /<a\b|href=|<iframe\b|<script\b/);
    assert.ok(html.includes(destination), `destination must remain visible: ${destination}`);
    assert.match(html, /não navegável/);
  }
});

test("reports never fetch images or render embedded HTML and preserve code as text", () => {
  const content = '# Plano\n\n![Diagrama](https://example.org/image.png)\n\n<script>alert("unsafe")</script>\n\n```html\n<img src="https://example.org/tracker">\n```';
  const html = render(content);
  assert.doesNotMatch(html, /<img\b|<script\b|<iframe\b/);
  assert.match(html, /Imagem citada: Diagrama/);
  assert.match(html, /https:\/\/example\.org\/image\.png/);
  assert.match(html, /<pre><code class="language-html">/);
  assert.match(html, /&lt;img src=&quot;https:\/\/example\.org\/tracker&quot;&gt;/);
});

test("report headings nest below the host h3 and do not regress at deep markdown levels", () => {
  const html = render("# Plano\n\n## Etapas\n\n### Validação\n\n#### Detalhe\n\n##### Nota\n\n###### Evidência");
  assert.deepEqual([...html.matchAll(/<h([1-6])>/g)].map(match => Number(match[1])), [4, 5, 6, 6, 6, 6]);
});

test("long reference addresses, inline code and fenced code remain complete", () => {
  const url = "https://example.org/" + "evidence".repeat(100);
  const html = render(`[Fonte](${url})\n\n\`const safe = true\`\n\n\`\`\`ts\nconst message = "<unsafe>";\n\`\`\``);
  assert.ok(html.includes(`href="${url}"`));
  assert.ok(html.includes(`>${url}<`));
  assert.match(html, /<code>const safe = true<\/code>/);
  assert.match(html, /const message = &quot;&lt;unsafe&gt;&quot;;/);
});
