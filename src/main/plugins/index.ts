import { app } from 'electron';
import log from 'electron-log';

import fs from 'fs-extra';
import path from 'path';

import { PluginManager } from 'live-plugin-manager';

import { spawn, Worker, Thread } from 'threads';
import { getPluginInfo, getPluginManagerProps, installPlugin, pluginsUpdated } from 'plugins';
import { Methods as WorkerMethods, WorkerSpec } from './worker';


const devFolder = app.isPackaged === false ? process.env.PANERON_PLUGIN_DIR : undefined;


if (devFolder) {
  log.warn("Using development plugin folder", devFolder);
}


installPlugin.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);

  let version: string;
  if (devFolder === undefined) {
    version = (await (await worker).install({ name })).installedVersion;
  } else {
    version = (await (await worker)._installDev({ name, fromPath: devFolder })).installedVersion;
  }

  await pluginsUpdated.main!.trigger({
    changedIDs: [id],
  });

  (await pluginManager).install(name, version);

  return { installed: true };
});


getPluginInfo.main!.handle(async ({ id }) => {
  const name = getNPMNameForPlugin(id);
  try {
    return await (await worker).getInfo({ name, doOnlineCheck: devFolder === undefined });
  } catch (e) {
    log.error("Cannot fetch plugin info", e, e.code, e.name, e.message);
    throw e;
  }
});


getPluginManagerProps.main!.handle(async () => {
  return {
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  };
});


function getNPMNameForPlugin(pluginID: string): string {
  return `@riboseinc/paneron-extension-${pluginID}`;
}



// Worker

const CWD = app.getPath('userData');
const PLUGINS_PATH = path.join(CWD, 'plugins');
const PLUGIN_CONFIG_PATH = path.join(CWD, 'plugin-config.yaml');

const pluginManager: Promise<PluginManager> = new Promise((resolve, _) => {
  resolve(new PluginManager({
    cwd: CWD,
    pluginsPath: PLUGINS_PATH,
  }));
});

const worker: Promise<Thread & WorkerMethods> = new Promise((resolve, reject) => {
  log.debug("Plugins: Spawning worker");

  if (devFolder !== undefined) {
    fs.removeSync(PLUGIN_CONFIG_PATH);
    fs.removeSync(PLUGINS_PATH);

    log.debug("Plugins: Cleared paths");
  }

  spawn<WorkerSpec>(new Worker('./worker')).
  then((worker) => {
    log.debug("Plugins: Spawning worker: Done");

    async function terminateWorker() {
      log.debug("Plugins: Terminating worker")
      await Thread.terminate(worker);
    }

    app.on('quit', terminateWorker);

    Thread.events(worker).subscribe(evt => {
      log.debug("Plugins: Worker event:", evt);
      // TODO: Respawn on worker exit?
    });

    log.debug("Plugins: Initializing worker");

    worker.initialize({
      cwd: CWD,
      pluginsPath: PLUGINS_PATH,
      pluginConfigPath: PLUGIN_CONFIG_PATH,
    }).
    then(() => {
      log.debug("Plugins: Initializing worker: Done");

      log.debug("Plugins: Installing plugins");
      worker.listInstalledPlugins().
      then((plugins) => {
        pluginManager.
        then(manager => {
          for (const plugin of plugins) {
            log.silly("Plugins: Installing in main", plugin.name, plugin.version);
            manager.install(plugin.name, plugin.version).
            then(plugin =>
              manager.require(plugin.name)
            ).catch(reject);
          }
          resolve(worker);
        }).catch(reject);
      }).
      catch(reject);
    }).
    catch(reject);
  }).
  catch(reject);
});
