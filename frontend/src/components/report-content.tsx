import type { ReactNode } from "react";
import Markdown from "react-markdown";

function isExternalReference(address: string) {
  if (!/^https?:\/\//i.test(address) || /[\u0000-\u0020\u007f]/.test(address)) return false;
  try {
    const url = new URL(address);
    return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function Reference({ address = "", children }: { address?: string; children: ReactNode }) {
  return (
    <span className="report-reference">
      {isExternalReference(address) ? (
        <a href={address} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
          {children} — <code>{address}</code> (nova aba)
        </a>
      ) : (
        <>{children} — <code>{address || "endereço não informado"}</code> (referência não navegável)</>
      )}
    </span>
  );
}

export function ReportContent({ content }: { content: string }) {
  return (
    <div className="report-content">
      <Markdown skipHtml urlTransform={address => address} components={{
        h1: ({ children }) => <h4>{children}</h4>,
        h2: ({ children }) => <h5>{children}</h5>,
        h3: ({ children }) => <h6>{children}</h6>,
        h4: ({ children }) => <h6>{children}</h6>,
        h5: ({ children }) => <h6>{children}</h6>,
        h6: ({ children }) => <h6>{children}</h6>,
        a: ({ href, children }) => <Reference address={href}>{children}</Reference>,
        img: ({ src, alt }) => <span className="report-reference">Imagem citada: {alt || "sem descrição"} — <code>{typeof src === "string" ? src : "endereço não informado"}</code> (imagem não carregada)</span>,
      }}>{content}</Markdown>
    </div>
  );
}
