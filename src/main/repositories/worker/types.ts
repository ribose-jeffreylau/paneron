import { Observable } from 'threads/observable';
import { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import { ObjectDataset } from '@riboseinc/paneron-extension-kit/types/objects';
import { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import { SerializableObjectSpec } from '@riboseinc/paneron-extension-kit/types/object-spec';
import {
  AuthoringGitOperationParams,
  BufferCommitRequestMessage,
  CloneRequestMessage,
  CommitRequestMessage,
  DatasetOperationParams,
  DeleteRequestMessage,
  GitAuthentication,
  GitOperationParams,
  IndexStatus,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatus,
  RepoStatusUpdater,
  StatusRequestMessage,
} from 'repositories/types';


export namespace Git {

  export namespace WorkDir {

    export type Validate =
      (msg: GitOperationParams) => Promise<boolean>

    export type Init =
      (msg: GitOperationParams) => Promise<{ success: true }>

    export type DiscardUncommittedChanges =
      (msg: GitOperationParams & { pathSpec?: string }) =>
        Promise<{ success: true }>

    export type Delete =
      (msg: DeleteRequestMessage) => Promise<{ success: true }>

  }

  export namespace Remotes {

    export type Describe = (msg: {
      url: string
      auth: GitAuthentication
    }) => Promise<{ isBlank: boolean, canPush: boolean }>;

    export type AddOrigin = (msg: {
      workDir: string
      url: string
    }) => Promise<{ success: true }>;

    export type DeleteOrigin = (msg: {
      workDir: string
    }) => Promise<{ success: true }>

  }

  export namespace Sync {

    export type Clone =
      (msg: CloneRequestMessage, statusUpdater: RepoStatusUpdater) =>
        Promise<{ success: true }>

    export type Pull =
      (msg: PullRequestMessage, statusUpdater: RepoStatusUpdater) =>
        Promise<{
          success: true
          changedObjects: Record<string, ChangeStatus> | null
        }>

    export type Push =
      (msg: PushRequestMessage, statusUpdater: RepoStatusUpdater) =>
        Promise<{ success: true }>

  }
}


export namespace Repositories {

  export namespace Data {

    export type ReadBuffers = (msg: GitOperationParams & {
      paths: string[]
    }) => Promise<BufferDataset>

    export type UpdateBuffers =
      (msg: BufferCommitRequestMessage, statusUpdater: RepoStatusUpdater) =>
        Promise<CommitOutcome>

    export type DeleteTree = (msg: AuthoringGitOperationParams & {
      treeRoot: string
      commitMessage: string
    }) => Promise<CommitOutcome>

  }
}


export namespace Datasets {


  export namespace Lifecycle {
    /* Registers object specs and starts creating the default index
       that contains all objects in the dataset. */
    export type Load = (msg: DatasetOperationParams & {
      objectSpecs: SerializableObjectSpec[]
    }) => Promise<void>


    /* Stops all indexing, deregisters object specs. */
    export type Unload = (msg: DatasetOperationParams) => Promise<void>
  }


  export namespace Indexes {
    /* Creates a custom index that filters items in default index
       using given query expression that evaluates in context of each object.

       Custom indexes contain object paths only, object data
       is retrieved from default index.

       Returns index ID that can be used to query items.
    */
    export type GetOrCreate = (msg: DatasetOperationParams & {
      queryExpression: string
    }) => { indexID: string }

    /* If indexID is omitted, default index is described. */
    export type Describe = (msg: DatasetOperationParams & {
      indexID?: string
    }) => { status: IndexStatus, stream: Observable<IndexStatus> }

    /* If indexID is omitted, objects in default index are counted. */
    export type CountObjects = (msg: DatasetOperationParams & {
      indexID?: string
    }) => Promise<{ objectCount: number }>

    /* Retrieves dataset-relative path of an object
       in the index at specified position. */
    export type GetObject = (msg: DatasetOperationParams & {
      indexID: string
      position: number
    }) => Promise<{ objectPath: string }>
  }


  export namespace Data {

    /* Counts all objects in the dataset using default index. */
    export type CountObjects =
      (msg: DatasetOperationParams) => Promise<{ objectCount: number }>

    /* Returns structured data of objects matching given paths.
       Uses object specs to build objects from buffers. */
    export type ReadObjects = (msg: DatasetOperationParams & {
      objectPaths: string[]
    }) => Promise<ObjectDataset>

    /* Converts given objects to buffers using previously registered object specs,
      checks for conflicts,
      makes changes to buffers in working area,
      stages and commits.
      Returns commit hash and/or conflicts, if any. */
    export type UpdateObjects =
      (msg: CommitRequestMessage) => Promise<CommitOutcome>
  }
}


export default interface WorkerMethods {
  destroyWorker: () => Promise<void>

  streamStatus: (msg: StatusRequestMessage) => Observable<RepoStatus>


  // Git operations

  git_init: Git.WorkDir.Init
  git_delete: Git.WorkDir.Delete

  git_clone: Git.Sync.Clone

  git_pull: Git.Sync.Pull
  git_push: Git.Sync.Push

  git_describeRemote: Git.Remotes.Describe
  git_addOrigin: Git.Remotes.AddOrigin
  git_deleteOrigin: Git.Remotes.DeleteOrigin


  // Housekeeping

  git_workDir_validate: Git.WorkDir.Validate
  git_workDir_discardUncommittedChanges: Git.WorkDir.DiscardUncommittedChanges


  // Working with structured datasets

  /* Associates object specs with dataset path.
     Typically called when a dataset is opened.
     Specs are used when reading and updating objects and when building indexes.
     Base object index is used when querying objects by path.
  */
  ds_load: Datasets.Lifecycle.Load

  /* Called when e.g. dataset window is closed. */
  ds_unload: Datasets.Lifecycle.Unload

  ds_readObjects: Datasets.Data.ReadObjects
  ds_updateObjects: Datasets.Data.UpdateObjects


  // Working with indexes

  ds_index_getOrCreate: Datasets.Indexes.GetOrCreate
  ds_index_describe: Datasets.Indexes.Describe
  ds_index_countObjects: Datasets.Indexes.CountObjects
  ds_index_getObject: Datasets.Indexes.GetObject


  // Working with raw unstructured data (internal)

  repo_readBuffers: Repositories.Data.ReadBuffers
  repo_updateBuffers: Repositories.Data.UpdateBuffers
  repo_deleteTree: Repositories.Data.DeleteTree
}