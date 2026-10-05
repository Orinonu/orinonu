import importlib.util, pathlib, tempfile, tomllib, unittest, json
spec=importlib.util.spec_from_file_location('configure',pathlib.Path(__file__).parents[1]/'scripts/configure.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Configuration(unittest.TestCase):
    def test_global_install_preserves_unrelated_credentials_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);codex=root/'.codex';codex.mkdir()
            (codex/'config.toml').write_text('model="existing-model"\n[mcp_servers.other]\nenv={TOKEN="private-test-value"}\n[features]\nhooks=true\n')
            local=root/'.agents/skills/tdd';local.mkdir(parents=True);(local/'SKILL.md').write_text('test')
            duplicate=codex/'plugins/cache/openai-curated-remote/matt-skills-curated/1/skills/tdd';duplicate.mkdir(parents=True);(duplicate/'SKILL.md').write_text('test')
            module.configure(root,codex,root,'codex.exe');module.configure(root,codex,root,'codex.exe')
            config=tomllib.loads((codex/'config.toml').read_text())
            self.assertEqual(config['mcp_servers']['other']['env']['TOKEN'],'private-test-value')
            self.assertEqual(config['model'],'existing-model')
            self.assertEqual(len(config['skills']['config']),1)
            self.assertIn('resolve_decision',config['mcp_servers']['jev_decisions']['enabled_tools'])
            self.assertEqual(config['model_auto_compact_token_limit'],100000)
            hooks=json.loads((codex/'hooks.json').read_text())['hooks']
            self.assertEqual(len(hooks['UserPromptSubmit']),1)
            self.assertIn('consult.ps1',hooks['UserPromptSubmit'][0]['hooks'][0]['command'])
    def test_devin_hooks_mirror_codex_hooks_without_touching_other_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);codex=root/'.codex';codex.mkdir()
            devin=root/'AppData'/'devin'/'config.json';devin.parent.mkdir(parents=True)
            other={'matcher':'exec','hooks':[{'type':'command','command':'node "C:/other/tool/check.mjs"'}]}
            devin.write_text(json.dumps({'version':1,'permissions':{'allow':['Exec(ls)']},'hooks':{'PreToolUse':[other],'PostToolUse':[{'matcher':'','hooks':[{'type':'command','command':'node "C:/old/jev-mission-control/scripts/devin-hook-observe.mjs"'}]}]}}))
            module.configure(root,codex,root,'codex.exe',devin);module.configure(root,codex,root,'codex.exe',devin)
            config=json.loads(devin.read_text())
            self.assertEqual(config['permissions'],{'allow':['Exec(ls)']})
            self.assertEqual(config['version'],1)
            hooks=config['hooks']
            self.assertEqual(hooks['PreToolUse'],[other])
            for kind in ('SessionStart','UserPromptSubmit','PostToolUse'):
                self.assertEqual(len(hooks[kind]),1,kind)
            commands=lambda kind:[h['command'] for h in hooks[kind][0]['hooks']]
            self.assertEqual(len(commands('SessionStart')),2)
            self.assertIn('devin-hook-start.mjs',commands('SessionStart')[0])
            self.assertIn('devin-hook-context.mjs',commands('SessionStart')[1])
            self.assertIn('devin-hook-context.mjs',commands('UserPromptSubmit')[0])
            self.assertIn('devin-hook-observe.mjs',commands('PostToolUse')[0])
            self.assertTrue(all('.codex/tools/jev-mission-control/scripts/' in c for kind in ('SessionStart','UserPromptSubmit','PostToolUse') for c in commands(kind)))
            self.assertTrue(all(h['timeout']==5 for kind in hooks for entry in hooks[kind] for h in entry['hooks'] if 'jev-mission-control' in h['command']))
            self.assertTrue(list((codex/'mission-control'/'backups').glob('*/devin-config.json')))
    def test_devin_hooks_are_skipped_unless_a_config_path_is_given(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);codex=root/'.codex';codex.mkdir()
            module.configure(root,codex,root,'codex.exe')
            self.assertEqual(list(root.rglob('config.json')),[])
if __name__=='__main__':unittest.main()
