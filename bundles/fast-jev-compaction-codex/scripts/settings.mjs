import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function readHarnessConfiguration({environmentKey='',dataDir=process.env.JEV_MISSION_DATA_DIR??join(homedir(),'.codex','mission-control'),loadModule=()=>import(pathToFileURL(join(homedir(),'.codex','tools','jev-decisions','typesafe-settings.mjs')).href)}={}){
  let shared;
  try{shared=await loadModule();}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')return {apiKey:environmentKey};throw new Error('private_settings_unavailable');}
  try{return shared.createTypesafeSettings({dataDir,repositoryRoot:join(homedir(),'.codex','tools','jev-decisions'),environmentKey}).credentials();}catch{throw new Error('private_settings_unavailable');}
}
