import { expose } from 'threads/worker';
import { ModuleMethods } from 'threads/dist/types/master';

import * as fs from 'fs-extra';
import * as path from 'path';

import * as yaml from 'js-yaml';
import AsyncLock from 'async-lock';

import { IPluginInfo, PluginManager } from 'live-plugin-manager';

import { InstalledPluginInfo } from 'plugins/types';
import { MainPlugin } from '@riboseinc/paneron-extension-kit/types';


interface InstalledPlugins {
  [pluginName: string]: InstalledPluginInfo
}

interface PluginConfigData {
  installedPlugins: {
    [pluginName: string]: Pick<InstalledPluginInfo, 'installedVersion'>
  }
}

//let plugins: InstalledPlugins = {}

let manager: PluginManager | null = null;

let configPath: string | null = null;

const pluginLock = new AsyncLock();

const installedPlugins: InstalledPlugins = {};

// { datasetID: { objectPath: { field1: value1, ... }}}
const datasetIndexes: Record<string, Record<string, Record<string, any>>> = {};


export interface Methods {

  /* Initialize plugin manager and config file.
     Must be called before anything else on freshly started worker. */
  initialize: (msg: { cwd: string, pluginsPath: string, pluginConfigPath: string }) => Promise<void>

  /* Install latest version if not installed;
     if already installed, do nothing;
     if already installed but version recorded in the configuration does not match installed version, update that;
     return factually installed version. */
  install: (msg: { name: string, version?: string }) => Promise<{ installedVersion: string }>

  remove: (msg: { name: string }) => Promise<{ success: true }>

  /* Development environment helper. Installs from a special path in user’s app data. */
  _installDev: (msg: { name: string, fromPath: string }) => Promise<{ installedVersion: string }>

  getInstalledVersion: (msg: { name: string }) => Promise<{ installedVersion: string | null }>

  listInstalledPlugins: () => Promise<IPluginInfo[]>


  /* Given raw data, creates or updates object index. */
  indexData: (msg: { pluginName: string, datasetID: string, rawData: Record<string, Uint8Array> }) =>
    Promise<{ success: true, indexedKeys: number }>

  clearIndex: (msg: { datasetID: string }) => Promise<{ success: true }>

  // Following methods operate on indexed dataset data.

  readObjects: (msg: { datasetID: string, objectPaths: string[] }) =>
    Promise<{ data: Record<string, Record<string, any>> }>

  listObjectPaths: (msg: { datasetID: string, queryExpression?: string }) =>
    Promise<{ objectPaths: string[] }>

}


export type WorkerSpec = ModuleMethods & Methods;


function assertInitialized() {
  if (manager === null || configPath === null) {
    throw new Error("Plugin worker not initialized");
  }
}


async function readConfig(): Promise<PluginConfigData> {
  assertInitialized();

  let configData: PluginConfigData;
  try {
    const rawData = await fs.readFile(configPath!, { encoding: 'utf-8' });
    configData = yaml.load(rawData);
  } catch (e) {
    return { installedPlugins: {} };
  }
  if (configData.installedPlugins === undefined) {
    return { installedPlugins: {} };
  }
  return configData;
}


async function updateConfig(updater: (data: PluginConfigData) => PluginConfigData): Promise<void> {
  assertInitialized();

  const config: PluginConfigData = await readConfig();
  const newConfig = updater(config);
  await fs.writeFile(configPath!, yaml.dump(newConfig, { noRefs: true }), { encoding: 'utf-8' });
}


const methods: WorkerSpec = {

  async initialize({ cwd, pluginsPath, pluginConfigPath }) {
    await fs.ensureDir(pluginsPath);
    await fs.ensureFile(pluginConfigPath);

    manager = new PluginManager({
      cwd,
      pluginsPath,
      lockWait: 10000,
    });

    configPath = pluginConfigPath;

    let plugins: PluginConfigData["installedPlugins"]
    try {
      plugins = (await readConfig()).installedPlugins;
    } catch (e) {
      await fs.remove(configPath);
      await updateConfig(() => ({ installedPlugins: {} }));
      plugins = {};
    }

    for (const [name, info] of Object.entries(plugins)) {
      await manager.installFromNpm(name, info.installedVersion || undefined);
    }
  },

  async listInstalledPlugins() {
    return await manager!.list();
  },

  async getInstalledVersion({ name }) {
    return { installedVersion: await getInstalledVersion(name) };
  },

  async remove({ name }) {
    await pluginLock.acquire('1', async () => {
      assertInitialized();

      if (installedPlugins[name]) {
        delete installedPlugins[name];
      }

      (await manager!.uninstall(name));

      await updateConfig((data) => {
        const newData = { ...data };
        delete newData.installedPlugins[name];
        return newData;
      });
    });

    return { success: true };
  },

  async install({ name, version }) {
    const installedVersion: string | undefined = await pluginLock.acquire('1', async () => {
      assertInitialized();

      let installedVersion: string | undefined;

      if (version === undefined) {
        const foundVersion = (await manager!.getInfo(name))?.version;
        if (foundVersion) {
          installedVersion = foundVersion;
        } else {
          await manager!.installFromNpm(name);
          installedVersion = (await manager!.getInfo(name))?.version;
        }
      } else {
        await manager!.installFromNpm(name, version);
        installedVersion = (await manager!.getInfo(name))?.version;
      }

      await updateConfig((data) => {
        const newData = { ...data };

        if (installedVersion === undefined) {
          delete newData.installedPlugins[name];
        } else if (installedVersion !== newData.installedPlugins[name]?.installedVersion) {
          newData.installedPlugins[name] = { installedVersion };
        }

        return newData;
      });

      return installedVersion;
    });

    if (!installedVersion) {
      throw new Error("Failed to install");
    }

    return { installedVersion };
  },

  async _installDev({ name, fromPath }) {
    // TODO: DRY
    const installedVersion: string | undefined = await pluginLock.acquire('1', async () => {
      assertInitialized();

      const { version } = await manager!.installFromPath(path.join(fromPath, name));

      await updateConfig((data) => {
        const newData = { ...data };

        if (version === undefined) {
          delete newData.installedPlugins[name];
        } else if (version !== newData.installedPlugins[name]?.installedVersion) {
          newData.installedPlugins[name] = { installedVersion: version };
        }
        return newData;
      });

      if (!version) {
        throw new Error("Failed to install");
      }
      return version;
    });
    return { installedVersion };
  },

  async indexData({ pluginName, datasetID, rawData }) {
    const plugin = await requireMainPlugin(pluginName);
    datasetIndexes[datasetID] = plugin.indexObjects(rawData);
    return {
      success: true,
      indexedKeys: Object.keys(datasetIndexes[datasetID]).length,
    };
  },

  async clearIndex({ datasetID }) {
    delete datasetIndexes[datasetID];
    return { success: true };
  },

  async readObjects({ datasetID, objectPaths }) {
    const index = datasetIndexes[datasetID];
    const requestedObjectData = objectPaths.
      map(path => ({ [path]: index[path] })).
      reduce((p, c) => ({ ...p, ...c }), {});
    return { data: requestedObjectData };
  },

  async listObjectPaths({ datasetID }) {
    const index = datasetIndexes[datasetID];
    return { objectPaths: Object.keys(index) };
  },

};


expose(methods);



// Requiring plugins in worker

const _runtimePluginInstanceCache: Record<string, MainPlugin> = {};

async function getInstalledVersion(name: string): Promise<string | null> {
  return (await readConfig()).installedPlugins[name]?.installedVersion || null;

}

export async function requireMainPlugin(name: string, version?: string): Promise<MainPlugin> {
  if (!manager) {
    throw new Error("Plugin manager is not initialized");
  }

  if (!_runtimePluginInstanceCache[name]) {
    const installedVersion = await getInstalledVersion(name);
    if (!installedVersion) {
      throw new Error("Extension is not installed");
    }
    if (version !== undefined && installedVersion !== version) {
      throw new Error("Installed extension version is different from requested");
    }

    // XXX: this does not work in worker thread!
    const plugin: MainPlugin = await manager!.require(name).default;

    _runtimePluginInstanceCache[name] = plugin;
  }

  return _runtimePluginInstanceCache[name];
}
