import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const source = new URL("../out/", import.meta.url),
  destination = new URL("../../public/ui/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
// Only Next's bootstrap scripts get a CSP hash. The supervisor stays strict
// and never allows arbitrary inline JavaScript or eval.
const { createHash } = await import("node:crypto");
const html = await readFile(new URL("index.html", destination), "utf8");
const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(([, attributes]) => !attributes.includes("src="))
  .map(
    ([, , content]) =>
      `'sha256-${createHash("sha256").update(content).digest("base64")}'`,
  );
await writeFile(
  new URL("csp.json", destination),
  JSON.stringify({ scriptHashes: [...new Set(hashes)] }) + "\n",
);
console.log("UI estática exportada para " + fileURLToPath(destination));
