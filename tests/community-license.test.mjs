import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('the public license is standard PolyForm and third-party MIT grants are preserved',()=>{
 const license=read('LICENSE');
 assert.match(license,/PolyForm Noncommercial License 1\.0\.0/);
 assert.match(license,/Any noncommercial purpose is a permitted purpose\./);
 assert.match(read('NOTICE'),/Ori Inonu \(ori-inonu\)/);
 assert.match(read('THIRD_PARTY_NOTICES.md'),/bundles\/skills/);
 assert.match(read('THIRD_PARTY_NOTICES.md'),/bundles\/fast-jev-compaction-codex/);
 for(const path of ['bundles/skills/LICENSE.mattpocock','bundles/fast-jev-compaction-codex/LICENSE','bundles/fast-jev-compaction-codex/vendor/fast-jev-compaction/LICENSE'])assert.match(read(path),/MIT License/);
 assert.equal(JSON.parse(read('package.json')).license,'PolyForm-Noncommercial-1.0.0');
});

test('official direction and commercial contribution consent have an explicit human owner',()=>{
 const governance=read('GOVERNANCE.md'),contributions=read('CONTRIBUTING.md'),agreement=read('CLA.md');
 for(const value of ['ori-inonu','Missão','Visão','Valores','Princípios','autonomia','evidências'])assert.ok(governance.includes(value),value);
 assert.match(governance,/não.*(?:bloqueia|impede).*forks/i);
 assert.match(governance,/CODEOWNERS.*não.*(?:substitui|impõe)/);
 assert.match(contributions,/CLA\.md/);
 assert.match(agreement,/não exclusiva/);
 assert.match(agreement,/serviços oficiais pagos/);
 assert.match(agreement,/mantém.*autoria/);
 assert.match(agreement,/aceite explícito/);
 assert.match(read('CODEOWNERS'),/\/GOVERNANCE\.md\s+@ori-inonu/);
});
