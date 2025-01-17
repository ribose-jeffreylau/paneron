/**
 * Responsible for API made available to extensions.
 *
 * Mostly about dataset manipulation,
 * but some of it is about persisting GUI state,
 * accessing settings and interoperating with outside world.
 */

import * as R from 'ramda';
import log from 'electron-log';
import { useEffect, useState } from 'react';

import type { DatasetContext } from '@riboseinc/paneron-extension-kit/types';
import type { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { type IndexStatus, INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';
import type { Hooks } from '@riboseinc/paneron-extension-kit/types/renderer';
import { INITIAL_GLOBAL_SETTINGS } from '@riboseinc/paneron-extension-kit/settings';
import type { BaseAction, PersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/usePersistentStateReducer';
import useTimeTravelingPersistentStateReducer, { type TimeTravelingPersistentStateReducerHook } from '@riboseinc/paneron-extension-kit/useTimeTravelingPersistentStateReducer';

import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { makeRandomID, chooseFileFromFilesystem, saveFileToFilesystem, openExternalURL } from 'common';
import { copyObjects, requestCopiedObjects } from 'clipboard/ipc';
import { describeBundledExecutable, describeSubprocess, execBundled, subprocessEvent } from 'subprocesses';
//import { SOLE_DATASET_ID } from 'repositories/types';
import { describeRepository } from 'repositories/ipc';
import { updateSetting, useSettings } from 'renderer/MainWindow/settings';

import {
  addFromFilesystem,
  describeIndex,
  filteredIndexUpdated,
  getFilteredObject,
  getObjectDataset,
  getOrCreateFilteredIndex,
  indexStatusChanged,
  locateFilteredIndexPosition,
  mapReduce,
  objectsChanged,
  updateObjects,
  updateSubtree,
} from '../ipc';


interface BasicDatasetOptions {
  workingCopyPath: string
  datasetID: string
}

export interface ContextGetterProps extends BasicDatasetOptions {
  writeAccess: boolean
}


const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();


type BasicDatasetReadAPI = Pick<DatasetContext,
  'getObjectData'
| 'getMapReducedData'
| 'getBlob'
| 'useDecodedBlob'>

/** Returns basic extension context, read-only. */
export function getBasicReadAPI(contextOpts: BasicDatasetOptions): BasicDatasetReadAPI {
  const { workingCopyPath, datasetID } = contextOpts;
  const datasetParams = { workingCopyPath, datasetID };
  return {
    getObjectData: async function _getObjectData(opts) {
      const resp = await getObjectDataset.renderer!.trigger({
        ...datasetParams,
        ...opts,
      });

      return resp.result;
    },

    getMapReducedData: (async (opts) => {
      const result = (await mapReduce.renderer!.trigger({
        ...datasetParams,
        chains: opts.chains as Hooks.Data.MapReduceChains,
      })).result;
      if (result) {
        return result;
      } else {
        throw new Error("Error running map-reduce over dataset (no result)");
      }
    }) as DatasetContext["getMapReducedData"], // TODO: Avoid casting?

    // TODO: Are these required? Can invoke TextEncoder/TextDecoder directly

    // NOTE: Confusingly named? Not truly a hook
    useDecodedBlob: ({ blob }) => {
      return {
        asString: decoder.decode(blob),
      };
    },

    getBlob: async (val) => encoder.encode(val),
  };
}


type FilesystemAPI = Pick<DatasetContext,
  'requestFileFromFilesystem'
| 'writeFileToFilesystem'
| 'addFromFilesystem'>

/** Returns API for working with external files. */
function getFilesystemAPI(datasetParams: BasicDatasetOptions): FilesystemAPI {
  return {

    requestFileFromFilesystem:  async function  _requestFileFromFilesystem (opts, callback?: (data: ObjectDataset) => void) {
      const resp = await chooseFileFromFilesystem.renderer!.trigger(opts);
      log.info("Requested file from filesystem", opts, resp);
      if (callback) {
        callback(resp.result);
      }
      return resp.result;
    },

    writeFileToFilesystem: async function _writeFileToFilesystem (opts) {
      const { result } = await saveFileToFilesystem.renderer!.trigger(opts);
      return result;
    },

    addFromFilesystem: async function _addFromFilesystem (dialogOpts, commitMessage, targetPath, opts) {
      const { result } = await addFromFilesystem.renderer!.trigger({
        ...datasetParams,
        dialogOpts,
        commitMessage,
        targetPath,
        opts,
      });
      return result;
    },

  };
}


/** Returns context including data modification utilities and React hooks. */
export function getFullAPI(opts: ContextGetterProps): Omit<DatasetContext, 'title'> {
  const {
    writeAccess,
    workingCopyPath,
    datasetID,
  } = opts;

  const datasetParams = {
    workingCopyPath,
    datasetID,
  };

  function usePersistentDatasetStateReducer<S extends Record<string, any>, A extends BaseAction>
  (...opts: Parameters<PersistentStateReducerHook<S, A>>) {
    const effectiveOpts: Parameters<PersistentStateReducerHook<S, A>> = [
      // opts[0] is the storage key in the list of positional parameters.
      // Extension code should specify locally scoped key,
      // and this takes care of additionally scoping it by repository and dataset.
      `${workingCopyPath}/${datasetID}/${opts[0]}`,

      opts[1], opts[2],

      opts[3], opts[4], opts[5],
    ];
    return usePaneronPersistentStateReducer(...effectiveOpts);
  }

  function useTimeTravelingPersistentDatasetStateReducer<S extends Record<string, any>, A extends BaseAction>
  (...opts: Parameters<TimeTravelingPersistentStateReducerHook<S, A>>) {
    const effectiveOpts: Parameters<TimeTravelingPersistentStateReducerHook<S, A>> = [
      opts[0], opts[1],

      // opts[2] is the storage key in the list of positional parameters.
      // Extension code should specify locally scoped key,
      // and this takes care of additionally scoping it by repository and dataset.
      `${workingCopyPath}/${datasetID}/${opts[2]}`,

      opts[3], opts[4],

      opts[5], opts[6], opts[7],
    ];
    return useTimeTravelingPersistentStateReducer(...effectiveOpts);
  }

  const EXT_SETTINGS_SCOPE = `${workingCopyPath}-${datasetID}`;

  // function resolvePath(datasetRelativePath: string) {
  //   if (datasetID === SOLE_DATASET_ID) {
  //     return path.join(workingCopyPath, datasetRelativePath);
  //   } else {
  //     return path.join(workingCopyPath, datasetID, datasetRelativePath);
  //   }
  // }

  return {

    // TODO: Reinstate logging via electron-log through IPC or roll our own
    logger: console,

    ...getBasicReadAPI(datasetParams),
    ...getFilesystemAPI(datasetParams),

    openExternalLink: async ({ uri }) => {
      await openExternalURL.renderer!.trigger({
        url: uri,
      });
    },

    performOperation: <P>() => async () => (void 0) as unknown as P,

    useRemoteUsername: () => {
      const resp = describeRepository.renderer!.useValue(
        { workingCopyPath },
        { info: { gitMeta: { workingCopyPath, mainBranch: '' } }, isLoaded: false },
      );
      const remote = resp.value.info.gitMeta.remote;
      const username = remote ? remote.username : undefined;
      return {
        ...resp,
        value: { username },
      };
    },


    // Settings

    useSettings: () => {
      return useSettings(EXT_SETTINGS_SCOPE, {});
    },

    useGlobalSettings: () => {
      return useSettings('global', INITIAL_GLOBAL_SETTINGS);
    },

    updateSetting: async ({ key, value }) => {
      return await updateSetting(EXT_SETTINGS_SCOPE, { key, value });
    },


    // Basic data access

    useObjectData: function _useObjectData (opts) {
      const result = getObjectDataset.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { data: {} });

      objectsChanged.renderer!.useEvent(async ({ workingCopyPath, datasetID, objects }) => {
        if (
          workingCopyPath === datasetParams.workingCopyPath
          && datasetID === datasetParams.datasetID
          && (objects === undefined || R.intersection(Object.keys(objects), opts.objectPaths).length > 0)
        ) {
          result.refresh();
        }
      }, [workingCopyPath, datasetID, JSON.stringify(opts.objectPaths)]);

      return result;
    },

    useMapReducedData: function _useMapReducedData (opts) {
      const initial =
        Object.keys(opts.chains).
          map(cid => ({ [cid]: undefined })).
          reduce((prev, curr) => ({ ...prev, ...curr })) as Record<keyof typeof opts["chains"], undefined>;
      return mapReduce.renderer!.useValue({
        ...datasetParams,
        chains: opts.chains as Hooks.Data.MapReduceChains,
      }, initial);
    } as DatasetContext["useMapReducedData"], // TODO: Avoid casting?


    // Filtered indexes for windowed data access
    //
    // TODO: Simplify filtered index API

    useIndexDescription: function _useIndexDescription (opts) {
      const { indexID } = opts;

      const [status, setStatus] = useState<IndexStatus>(INITIAL_INDEX_STATUS);

      const result = describeIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { status: INITIAL_INDEX_STATUS });

      useEffect(() => {
        setStatus(result.value.status);
      }, [result.value.status]);

      indexStatusChanged.renderer!.useEvent(async (evt) => {
        if (
          workingCopyPath === evt.workingCopyPath &&
          datasetID === evt.datasetID &&
          indexID === evt.indexID
        ) {
          setStatus(evt.status);
          //result.refresh();
        }
      }, [workingCopyPath, datasetID, indexID]);

      return {
        ...result,
        value: {
          ...result.value,
          status,
        },
      };
    },

    useFilteredIndex: function _useFilteredIndex (opts) {
      const resp = getOrCreateFilteredIndex.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { indexID: undefined });

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetID, indexID }) => {
        if (resp.value.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetID === datasetParams.datasetID) {
          resp.refresh();
        }
      }, [opts.queryExpression]);

      return resp;
    },

    useObjectPathFromFilteredIndex: function _useObjectPathFromFilteredIndex (opts) {
      const resp = getFilteredObject.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { objectPath: '' });

      filteredIndexUpdated.renderer!.useEvent(async ({ workingCopyPath, datasetID, indexID }) => {
        if (opts.indexID === indexID && workingCopyPath === datasetParams.workingCopyPath && datasetID === datasetParams.datasetID) {
          resp.refresh();
        }
      }, [opts.indexID, opts.position]);

      return resp;
    },

    getObjectPathFromFilteredIndex: async (opts) => {
      const result = (await getFilteredObject.renderer!.trigger({
        ...datasetParams,
        ...opts,
      })).result;
      if (result) {
        return result;
      } else {
        throw new Error("Unable to retrieve object path from filtered index");
      }
    },

    useFilteredIndexPosition: function _useFilteredIndexPosition (opts) {
      return locateFilteredIndexPosition.renderer!.useValue({
        ...datasetParams,
        ...opts,
      }, { position: null });
    },

    getFilteredIndexPosition: async (opts) => {
      const result = (await locateFilteredIndexPosition.renderer!.trigger({
        ...datasetParams,
        ...opts,
      })).result;
      if (result) {
        return result;
      } else {
        throw new Error("Unable to retrieve index position from given object path");
      }
    },


    // Persisting state

    usePersistentDatasetStateReducer,
    useTimeTravelingPersistentDatasetStateReducer,


    // Writing data

    makeRandomID: writeAccess
      ? async function _makeRandomID () {
          const id = (await makeRandomID.renderer!.trigger({})).result?.id;
          if (!id) {
            throw new Error("Unable to obtain a random ID");
          }
          return id;
        }
      : undefined,

    updateObjects: writeAccess
      ? async function _updateObjects (opts) {
          const result = (await updateObjects.renderer!.trigger({
            ...datasetParams,
            ...opts,
          }));
          return result.result;
        }
      : undefined,

    updateTree: writeAccess
      ? async function _updateSubtree (opts) {
          const result = (await updateSubtree.renderer!.trigger({
            ...datasetParams,
            ...opts,
          }));
          return result.result;
        }
      : undefined,


    // Deprecated

    getObjectView: () => undefined,


    // Copying objects between datasets (provisional)

    copyObjects: async (dataset) => {
      await copyObjects.renderer!.trigger({
        workDir: workingCopyPath,
        datasetDir: datasetID,
        objects: dataset,
      });
    },

    requestCopiedObjects: async () => {
      const { result } = await requestCopiedObjects.renderer!.trigger({});
      return result;
    },


    // Node-specific (obsolete)

    // getRuntimeNodeModulePath: moduleName =>
    //   path.join(nodeModulesPath, moduleName),

    // makeAbsolutePath: relativeDatasetPath => {
    //   return resolvePath(relativeDatasetPath);
    // },

    // TODO: Support LFS with absolute paths.
    // useAbsolutePath: async (relativeDatasetPath) => {
    //   const { result } = await getAbsoluteBufferPath.renderer!.trigger({
    //     workingCopyPath,
    //     bufferPath: resolvePath(relativeDatasetPath),
    //   });
    //   if (result) {
    //     return result.absolutePath;
    //   } else {
    //     throw new Error("Unable to resolve absolute path");
    //   }
    // },


    // Metanorma

    invokeMetanorma: async function _invokeMetanorma ({ cliArgs }) {
      await describeBundledExecutable.renderer!.trigger({ name: METANORMA_BINARY_NAME });
      const { result: subprocessDescription } = await execBundled.renderer!.trigger({
        id: METANORMA_SUBPROCESS_TRACKING_ID,
        opts: {
          binaryName: METANORMA_BINARY_NAME,
          cliArgs,
        }
      });
      return subprocessDescription;
    },

    useMetanormaInvocationStatus: function _useMetanormaInvocationStatus () {
      //const [desc, updateDesc] = useState<SubprocessDescription | null>(null);
      const desc = describeSubprocess.renderer!.useValue({ id: METANORMA_SUBPROCESS_TRACKING_ID }, {
        pid: -1,
        opts: {
          binaryName: METANORMA_BINARY_NAME,
          cliArgs: [],
        },
        stdout: '',
        stderr: '',
      });

      subprocessEvent.renderer!.useEvent(async (evt) => {
        if (evt.id !== METANORMA_SUBPROCESS_TRACKING_ID) {
          return;
        } else {
          desc.refresh();
        }
      }, [desc.value.pid]);

      return {
        ...desc,
        value: desc.value.pid >= 0 ? desc.value : null,
      }
    },

    listExporters: () => {
      return {};
      // return (
      //   Object.entries(exportFormats).
      //   map(([formatID, { name, description }]) => ({ [formatID]: { name, description } })).
      //   reduce((prev, curr) => ({ ...prev, ...curr }), {})
      // );
    },
  }
}

const METANORMA_SUBPROCESS_TRACKING_ID = 'metanorma';
const METANORMA_BINARY_NAME = 'metanorma';
