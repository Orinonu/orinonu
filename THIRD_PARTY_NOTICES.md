# Autoria e licenças de terceiros

A licença PolyForm Noncommercial na raiz abrange o código próprio do Orinonu, salvo material com licença própria. Ela não retira permissões de componentes de terceiros, inclusive permissões comerciais concedidas por MIT.

| Material distribuído | Licença e aviso preservado | Proveniência |
| --- | --- | --- |
| Skills originárias de Matt Pocock em `bundles/skills` | MIT, `bundles/skills/LICENSE.mattpocock`; Copyright (c) 2026 Matt Pocock | Skills locais preservadas; novos arquivos próprios não são automaticamente atribuídos a Matt Pocock. |
| Adaptador `bundles/fast-jev-compaction-codex` com licença própria | MIT, `bundles/fast-jev-compaction-codex/LICENSE` | Adaptação local descrita no README desse pacote. |
| Biblioteca vendorizada `bundles/fast-jev-compaction-codex/vendor/fast-jev-compaction` | MIT, `vendor/fast-jev-compaction/LICENSE` | `tamaratran/fast-jev-compaction`, versão 0.2.0, commit `e3f262a7f4d42bd8dd32ced30d26176f7cb545b0`. |
| Componentes derivados de shadcn/ui em `frontend/src/components/ui` | MIT do projeto shadcn/ui; aviso abaixo | Implementações adaptadas às primitivas Radix e ao design system Orinonu. |
| Runtime `bundles/orinonu-agents` e OpenAI Agents SDK | Código próprio sob a licença da raiz; dependências mantêm licenças próprias, incluindo MIT (c) 2025 OpenAI | SDK 0.18.0 e demais versões fixados no lockfile separado; o build preserva as licenças dos pacotes incorporados em `out/THIRD_PARTY_NOTICES.md`. |

## shadcn/ui

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## react-markdown

A renderização dos relatórios utiliza `react-markdown` 10.1.0, fixado no lockfile da interface.

The MIT License (MIT)

Copyright (c) Espen Hovlandsdal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Dependências instaladas e distribuições compiladas

`frontend/package-lock.json` fixa as dependências utilizadas. Next.js, React, Radix UI, Tailwind CSS, Lucide e os demais pacotes mantêm suas licenças e avisos próprios, presentes nos pacotes instalados. O pacote de código-fonte não inclui `node_modules` ou a interface compilada; uma distribuição de binários ou assets compilados deve preservar também os avisos exigidos por suas dependências. Este inventário de material vendorizado não substitui a revisão de todas as dependências transitivas de uma distribuição compilada.

Referências a Codex/OpenAI, Devin/Cognition, Hermes, TypeSafe/JEV e outros produtos identificam integrações ou fontes. Seus nomes e marcas não pertencem ao Orinonu; não há alegação de patrocínio ou afiliação oficial.
