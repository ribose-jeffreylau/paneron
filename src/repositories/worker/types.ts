import type { Observable } from 'threads/observable';
import type { ChangeStatus, CommitOutcome } from '@riboseinc/paneron-extension-kit/types/changes';
import type { BufferDataset } from '@riboseinc/paneron-extension-kit/types/buffers';
import type {
  AuthoringGitOperationParams,
  BufferCommitRequestMessage,
  CloneRequestMessage,
  DeleteRequestMessage,
  GitAuthentication,
  GitOperationParams,
  InitRequestMessage,
  PullRequestMessage,
  PushRequestMessage,
  RepoStatus,
  RepoStatusUpdater,
} from 'repositories/types';


export type ExposedGitRepoOperation<F extends (opts: any) => any> =
  (opts: Omit<Parameters<F>[0], 'workDir'>) =>
    ReturnType<F>


export type WithStatusUpdater<F extends (opts: any) => any> =
  (opts: Parameters<F>[0], statusUpdater: RepoStatusUpdater) =>
    ReturnType<F>


export namespace Git {

  export namespace WorkDir {

    export type Validate =
      (msg: GitOperationParams) => Promise<boolean>

    export type Init =
      (msg: InitRequestMessage) => Promise<{ success: true }>

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
    }) => Promise<{ isBlank: boolean, canPush: boolean, mainBranchName?: string }>;

    // TODO: workDir below is likely redundant?
    // repoOperation decorator provides it for initialized workers.
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
      (msg: CloneRequestMessage) =>
        Promise<{ success: true }>

    export type Pull =
      (msg: PullRequestMessage) =>
        Promise<{
          oidBeforePull: string
          oidAfterPull: string
        }>

    export type Push =
      (msg: PushRequestMessage) =>
        Promise<{ success: true }>

  }
}


export namespace Repositories {

  export namespace Data {

    export type ResolveChanges = (msg: GitOperationParams & {
      rootPath: string
      oidBefore: string
      oidAfter: string
    }) => Promise<{
      changedBuffers: [path: string, changeStatus: ChangeStatus][]
    }>

    export type ChooseMostRecentCommit = (msg: GitOperationParams & {
      candidates: string[]
    }) => Promise<{ commitHash: string }>

    export type GetCurrentCommit = (msg: GitOperationParams) =>
      Promise<{ commitHash: string }>

    export type GetBufferDataset = (msg: GitOperationParams & {
      paths: string[]
    }) => Promise<BufferDataset>

    export type ReadBuffers = (msg: GitOperationParams & {
      rootPath: string

      /** Remote URL is used for resolving LFS pointers. */
      remoteURL?: string

      /** Auth data is used for resolving LFS pointers. */
      auth?: GitAuthentication
    }) => Promise<Record<string, Uint8Array>>

    export type ReadBuffersAtVersion = (msg: GitOperationParams & {
      rootPath: string
      commitHash: string
    }) => Promise<Record<string, Uint8Array>>

    export type UpdateBuffers =
      (msg: BufferCommitRequestMessage) =>
        Promise<CommitOutcome>

    export type UpdateBuffersWithStatusReporter =
      WithStatusUpdater<UpdateBuffers>

    export type DeleteTree = (msg: AuthoringGitOperationParams & {
      treeRoot: string
      commitMessage: string
    }) => Promise<CommitOutcome>

    export type MoveTree = (msg: AuthoringGitOperationParams & {
      oldTreeRoot: string
      newTreeRoot: string
      commitMessage: string
    }) => Promise<CommitOutcome>

  }
}


export default interface WorkerMethods {
  destroy: () => Promise<void>

  /**
   * Initialize worker: give it Git repo’s working directory path,
   * and get an observable for monitoring repository status in return.
   */
  initialize: (msg: { workDirPath: string }) => Observable<RepoStatus>


  // Maybe also getLatestStatus() => Promise<RepoStatus>?

  // Git operations

  git_init: ExposedGitRepoOperation<Git.WorkDir.Init>
  git_delete: Git.WorkDir.Delete

  git_clone: ExposedGitRepoOperation<Git.Sync.Clone>

  git_pull: ExposedGitRepoOperation<Git.Sync.Pull>
  git_push: ExposedGitRepoOperation<Git.Sync.Push>

  git_describeRemote: Git.Remotes.Describe
  git_addOrigin: ExposedGitRepoOperation<Git.Remotes.AddOrigin>
  git_deleteOrigin: ExposedGitRepoOperation<Git.Remotes.DeleteOrigin>


  // Housekeeping

  git_workDir_validate: Git.WorkDir.Validate
  git_workDir_discardUncommittedChanges: ExposedGitRepoOperation<Git.WorkDir.DiscardUncommittedChanges>


  // Working with raw unstructured data (internal)

  /** Returns the hash of the latest commit in the repository. */
  repo_getCurrentCommit: Repositories.Data.GetCurrentCommit

  /**
   * Given a list of commit hashes,
   * walks back history and returns one that was created most recently.
   */
  repo_chooseMostRecentCommit: Repositories.Data.ChooseMostRecentCommit

  /**
   * Given a list of buffer paths,
   * returns a map of buffer paths to buffers or null.
   */
  repo_getBufferDataset: Repositories.Data.GetBufferDataset

  /**
   * Given a work dir and a rootPath, returns a map of descendant buffer paths
   * to buffer blobs. Resolves LFS pointers, in which case may take a while.
   */
  repo_readBuffers: Repositories.Data.ReadBuffers

  /**
   * Given a path, returns a map of descendant buffer paths
   * to buffers.
   */
  repo_readBuffersAtVersion: Repositories.Data.ReadBuffersAtVersion

  /** Updates buffers in repository. */
  repo_updateBuffers: Repositories.Data.UpdateBuffers

  /** Deletes repository subtree. Fast, but doesn’t validate data. */
  repo_deleteTree: Repositories.Data.DeleteTree

  /** Moves repository subtree to another location. Fast, but doesn’t validate data. */
  repo_moveTree: Repositories.Data.MoveTree

  /**
   * Takes commit hash before and after a change.
   * 
   * Infers which buffer paths changed,
   * infers which object paths in which datasets are affected,
   * reindexes objects as appropriate,
   * and sends IPC events to let Paneron & extension windows
   * refresh shown data.
   */
  repo_resolveChanges: Repositories.Data.ResolveChanges
}
