import fs from 'fs';
import { ensureDir } from 'fs-extra';
import path from 'path';
import { app, BrowserWindow, dialog, OpenDialogOptions } from 'electron';
import log from 'electron-log';
import { BufferChange } from '@riboseinc/paneron-extension-kit/types/buffers';
import { INITIAL_INDEX_STATUS } from '@riboseinc/paneron-extension-kit/types/indexes';

import { forceSlug } from 'utils';
import { checkPathIsOccupied } from 'main/checkPathIsOccupied';
import { serializeMeta } from 'main/meta-serdes';

import {
  // TODO: Define a more specific datasets changed event?
  repositoriesChanged,
  repositoryBuffersChanged,
} from 'repositories/ipc';

import { PaneronRepository } from 'repositories/types';

import { readRepoConfig } from 'repositories/main/readRepoConfig';
import { getLoadedRepository } from 'repositories/main/loadedRepositories';
import {
  readPaneronRepoMeta,
  PANERON_REPOSITORY_META_FILENAME,
  DATASET_FILENAME,
  readDatasetMeta,
} from 'repositories/main/meta';

import {
  deleteDataset,
  getDatasetInfo,
  initializeDataset,
  loadDataset,
  proposeDatasetPath,
  getObjectDataset,
  getOrCreateFilteredIndex,
  describeIndex,
  unloadDataset,
  getFilteredObject,
  locateFilteredIndexPosition,
  updateObjects,
  listRecentlyOpenedDatasets,
  updateSubtree,
  addFromFilesystem,
} from '../ipc';

import loadedDatasets from './loadedDatasets';
import { getObjectDataset as getDataset } from './objects/read';

import {
  addExternal,
  updateObjects as _updateObjects,
  updateTree as _updateTree,
} from './objects/update';

import {
  list as _listRecentlyOpenedDatasets,
  record as _recordRecentlyOpenedDataset,
} from './recent';


getDatasetInfo.main!.handle(async ({ workingCopyPath, datasetID }) => {
  try {
    return { info: await readDatasetMeta(workingCopyPath, datasetID) };
  } catch (e) {
    log.error("Error reading dataset meta", e);
    return { info: null };
  }
});


proposeDatasetPath.main!.handle(async ({ workingCopyPath, datasetPath }) => {
  if (!datasetPath.trim || !datasetPath.trim()) {
    throw new Error("Missing dataset path.");
  }

  const dir = forceSlug(datasetPath);
  const fullPath = path.join(workingCopyPath, dir);

  // For check to succeed, the path must not exist at all.

  // TODO: Accept a pre-existing empty directory as new dataset location?
  // We would have to validate it’s absolutely empty.
  const isOccupied = checkPathIsOccupied(fullPath);

  if (isOccupied) {
    return { path: undefined };
  } else {
    return { path: dir };
  }
});


initializeDataset.main!.handle(async ({ workingCopyPath, meta: datasetMeta, datasetPath }) => {
  if (!datasetPath.trim || !datasetPath.trim()) {
    throw new Error("Invalid or missing dataset path");
  }

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }

  // Prepare repo meta update
  const oldRepoMeta = await readPaneronRepoMeta(workingCopyPath);

  if (oldRepoMeta.dataset || oldRepoMeta.datasets === undefined) {
    throw new Error("This repository does not support multiple repositories");
  }

  const newRepoMeta: PaneronRepository = {
    ...oldRepoMeta,
    dataset: undefined,
    datasets: {
      ...oldRepoMeta.datasets,
      [datasetPath]: true,
    },
  };
  const repoMetaChange: BufferChange = {
    oldValue: serializeMeta(oldRepoMeta),
    newValue: serializeMeta(newRepoMeta),
  };

  // Prepare dataset meta addition
  const datasetMetaAddition: BufferChange = {
    oldValue: null,
    newValue: serializeMeta(datasetMeta),
  };

  const repos = getLoadedRepository(workingCopyPath).workers.sync;

  const datasetMetaPath = path.join(datasetPath, DATASET_FILENAME);

  const bufferChangeset = {
    [datasetMetaPath]: datasetMetaAddition,
    [PANERON_REPOSITORY_META_FILENAME]: repoMetaChange,
  };

  log.info("datasets: Initializing with buffer changeset", JSON.stringify(bufferChangeset, undefined, 4), datasetPath);

  const { newCommitHash } = await repos.repo_updateBuffers({
    workDir: workingCopyPath,
    commitMessage: `Initialize dataset at ${datasetPath}`,
    author,
    bufferChangeset,
  });

  if (newCommitHash) {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    await repositoryBuffersChanged.main!.trigger({
      workingCopyPath,
      changedPaths: {
        [datasetMetaPath]: true,
        [PANERON_REPOSITORY_META_FILENAME]: true,
      },
    });
    return { info: datasetMeta };
  } else {
    throw new Error("Dataset initialization failed to return a commit hash");
  }
});


const INDEX_DB_ROOT = path.join(app.getPath('userData'), 'index-dbs');


export async function clearIndexes() {
  fs.rmdirSync(INDEX_DB_ROOT, { recursive: true });
}


listRecentlyOpenedDatasets.main!.handle(async () => {
  return {
    datasets: await _listRecentlyOpenedDatasets(),
  };
});


loadDataset.main!.handle(async ({ workingCopyPath, datasetID }) => {
  await _recordRecentlyOpenedDataset(workingCopyPath, datasetID);

  log.debug("Datasets: Load: Ensuring cache root dir…", INDEX_DB_ROOT);

  await ensureDir(INDEX_DB_ROOT);

  //log.debug("Datasets: Load: Getting loaded repository worker");
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;

  log.debug("Datasets: Load: Loading dataset…");

  await loadedDatasets.load({ workDir: workingCopyPath, datasetID, cacheRoot: INDEX_DB_ROOT });

  log.debug("Datasets: Load: Done");

  return { success: true };
});


unloadDataset.main!.handle(async ({ workingCopyPath, datasetID }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
  log.debug("Unloading dataset", workingCopyPath, datasetID);
  await loadedDatasets.unload({ workDir: workingCopyPath, datasetID });
  return { success: true };
});


getOrCreateFilteredIndex.main!.handle(async ({ workingCopyPath, datasetID, queryExpression, keyExpression }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;

  const { indexID } = await loadedDatasets.getOrCreateFilteredIndex({
    workDir: workingCopyPath,
    datasetID,
    queryExpression,
    keyExpression,
  });

  //repoWorker.ds_index_streamStatus({
  //  workDir: workingCopyPath,
  //  datasetDir: datasetPath,
  //  indexID,
  //}).subscribe(status => {
  //  indexStatusChanged.main!.trigger({ workingCopyPath, datasetPath, status, indexID });
  //});

  return { indexID };
});


describeIndex.main!.handle(async ({ workingCopyPath, datasetID, indexID }) => {
  if (indexID !== '') {
    //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
    return await loadedDatasets.describeIndex({
      workDir: workingCopyPath,
      datasetID,
      indexID,
    });
  } else {
    return { status: INITIAL_INDEX_STATUS };
  }
});


getObjectDataset.main!.handle(async ({ workingCopyPath, datasetID, objectPaths, resolveLFS }) => {
  //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
  const data = await getDataset({
    workDir: workingCopyPath,
    datasetID,
    objectPaths,
    resolveLFS,
  });
  return { data };
});


getFilteredObject.main!.handle(async ({ workingCopyPath, datasetID, indexID, position }) => {
  if (!indexID) {
    return { objectPath: '' };
  } else {
    //const repoWorker = getLoadedRepository(workingCopyPath).workers.sync;
    const { objectPath } = await loadedDatasets.getFilteredObject({
      workDir: workingCopyPath,
      datasetID,
      indexID,
      position,
    });
    return { objectPath };
  }
});


locateFilteredIndexPosition.main!.handle(async ({ workingCopyPath, datasetID, indexID, objectPath }) => {
  if (!indexID || !objectPath) {
    return { position: null };
  } else {
    try {
      return await loadedDatasets.locatePositionInFilteredIndex({
        workDir: workingCopyPath,
        datasetID,
        indexID,
        objectPath,
      });
    } catch (e) {
      log.error("Failed to retrieve index position for object path", objectPath, indexID, e);
      return { position: null };
    }
  }
});


updateObjects.main!.handle(async ({ workingCopyPath, datasetID, objectChangeset, commitMessage, _dangerouslySkipValidation }) => {
  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }
  // TODO: Save new version in `updateObjects()` additionally, using some filesystem-based mechanism?
  return await _updateObjects({
    workDir: workingCopyPath,
    datasetID,
    objectChangeset,
    commitMessage,
    _dangerouslySkipValidation,
    author,
  });
});


updateSubtree.main!.handle(async ({ workingCopyPath, datasetID, commitMessage, subtreeRoot, newSubtreeRoot }) => {
  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }
  return await _updateTree({
    workDir: workingCopyPath,
    datasetID,
    commitMessage,
    author,
    oldSubtreePath: subtreeRoot,
    newSubtreePath: newSubtreeRoot,
  });
});


addFromFilesystem.main!.handle(async ({ workingCopyPath, datasetID, commitMessage, dialogOpts, targetPath, opts }) => {
  const window = BrowserWindow.getFocusedWindow();
  if (window === null) { throw new Error("Unable to choose file(s): no focused window detected"); }

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Repository configuration is missing author information");
  }

  const allowMultiple = opts.replaceTarget !== true && dialogOpts.allowMultiple;

  const properties: OpenDialogOptions["properties"] = [
    'openFile',
  ]
  if (allowMultiple) {
    properties.push('multiSelections');
  }

  const result = await dialog.showOpenDialog(window, {
    properties,
  });

  const filepaths = (result.filePaths || []);

  if (!allowMultiple && filepaths.length > 1) {
    throw new Error("More than one file was selected");
  }
  if (filepaths.length < 1) {
    return { commitOutcome: null };
  }

  const commitOutcome = await addExternal({
    workDir: workingCopyPath,
    datasetID,
    offloadToLFS: opts.offloadToLFS,
    commitMessage,
    absoluteFilepaths: filepaths,
    targetPath,
    replaceTarget: opts.replaceTarget,
    author,
  });

  return { commitOutcome };
});


deleteDataset.main!.handle(async ({ workingCopyPath, datasetID }) => {
  const w = getLoadedRepository(workingCopyPath).workers.sync;

  const { author } = await readRepoConfig(workingCopyPath);
  if (!author) {
    throw new Error("Missing author information in repository config");
  }

  const repoMeta = await readPaneronRepoMeta(workingCopyPath);
  if (!repoMeta.datasets?.[datasetID]) {
    throw new Error("Dataset is not found in Paneron repository meta");
  }

  // To ensure we are deleting a Paneron dataset
  await readDatasetMeta(workingCopyPath, datasetID);

  // Delete dataset tree
  const deletionResult = await w.repo_deleteTree({
    workDir: workingCopyPath,
    commitMessage: `Delete dataset at ${datasetID}`,
    author,
    treeRoot: datasetID,
  });

  if (!deletionResult.newCommitHash) {
    throw new Error("Failed while deleting dataset object tree");
  }

  // Update repo meta
  const oldMetaBuffer = serializeMeta(repoMeta);
  delete repoMeta.datasets[datasetID];
  const newMetaBuffer = serializeMeta(repoMeta);

  const datasetMetaPath = path.join(datasetID, DATASET_FILENAME);

  const repoMetaUpdateResult = await w.repo_updateBuffers({
    workDir: workingCopyPath,
    commitMessage: "Record dataset deletion",
    author,
    bufferChangeset: {
      [PANERON_REPOSITORY_META_FILENAME]: {
        oldValue: oldMetaBuffer,
        newValue: newMetaBuffer,
      }
    },
  });

  if (repoMetaUpdateResult.newCommitHash) {
    await repositoriesChanged.main!.trigger({
      changedWorkingPaths: [workingCopyPath],
    });
    await repositoryBuffersChanged.main!.trigger({
      workingCopyPath,
      changedPaths: {
        [datasetMetaPath]: true,
        [PANERON_REPOSITORY_META_FILENAME]: true,
      },
    });
    return { success: true };
  } else {
    throw new Error("Recording dataset deletion failed to return a commit hash");
  }

});
