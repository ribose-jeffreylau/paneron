/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button } from '@blueprintjs/core';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import PanelSeparator from '@riboseinc/paneron-extension-kit/widgets/panels/PanelSeparator';

import { addRepository, getNewRepoDefaults } from 'repositories/ipc';
import type { GitAuthor } from 'repositories/types';

import { stripTrailingSlash } from 'utils';
import { Context } from '../context';
import GitCredentialsInput from '../repositories/GitCredentialsInput';
import AuthorForm from '../repositories/AuthorForm';


const AddSharedRepository: React.FC<{ className?: string; onAfterCreate?: (workDir: string) => void }> =
function ({ className, onAfterCreate }) {
  const { performOperation, isBusy } = useContext(Context);

  // TODO: use a single state object to keep all parameters for addRepository?
  const [customUsername, setUsername] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remoteURL, setRemoteURL] = useState<string | null>(null);

  const [customBranch, setBranch] = useState<string | null>(null);

  const defaults = getNewRepoDefaults.renderer!.useValue(
    {},
    { defaults: { author: { name: '', email: '' } }}
  );

  const [customAuthor, setCustomAuthor] = useState<GitAuthor | null>(null);
  const author: GitAuthor | null = customAuthor ?? defaults.value.defaults?.author ?? null;

  const remoteComponents = stripTrailingSlash(remoteURL ?? '').split('/');
  const defaultName = remoteComponents[remoteComponents.length - 1];
  const name = defaultName;

  const username = customUsername ?? defaults.value.defaults?.remote?.username ?? '';
  const defaultBranch = defaults.value.defaults?.branch || 'main';
  const branch: string = customBranch || defaultBranch;

  const canImport =
    !isBusy &&
    (name ?? '').trim() !== '' &&
    (remoteURL ?? '').trim() !== '' &&
    (username ?? '').trim() !== '' &&
    (branch ?? '').trim() !== '' &&
    author?.name && author?.email;

  function clear() {
    setRemoteURL(null);
  }

  async function handleAdd() {
    if (!canImport) {
      throw new Error("Cannot import shared repository. Something went wrong, try again?");
    }

    const resp = await addRepository.renderer!.trigger({
      gitRemoteURL: stripTrailingSlash(remoteURL!),
      username,
      password: password !== '' ? password : undefined,
      branch,
      author,
    });
    if (resp.result?.workDir) {
      //await loadRepository.renderer!.trigger({ workingCopyPath: resp.result.workDir });
      onAfterCreate?.(resp.result.workDir);
    } else {
      throw new Error("Seems successful, but did not return working directory");
    }
    clear();
  }

  return (
    <div
        className={className}
        css={css`display: flex; flex-flow: column nowrap;`}>
      <div css={css`flex: 1;`}>
        <PanelSeparator
          title="Remote options"
          tooltip={<>Paneron uses Git VCS to synchronize data. This section describes upstream Git repository used as remote.</>}
        />
        <PropertyView
            label="Remote URL"
            tooltip={<>For repositories hosted on GitHub, use format <code>https://github.com/&lt;username&gt;/&lt;repository&gt;</code></>}>
          <TextInput
            value={remoteURL ?? ''}
            inputGroupProps={{
              required: true,
              type: 'url',
              placeholder: "https://github.com/some-username/some-repository",
            }}
            onChange={!isBusy ? (val) => setRemoteURL(val) : undefined}
          />
        </PropertyView>
        <PropertyView label="Branch" tooltip="Main branch’s name is typically ‘main’ or ‘master’.">
          <TextInput
            value={customBranch ?? ''}
            inputGroupProps={{ type: 'text', placeholder: branch }}
            onChange={!isBusy ? (val) => setBranch(val) : undefined}
          />
        </PropertyView>
        <GitCredentialsInput
          username={username}
          password={password}
          remoteURL={remoteURL ?? ''}
          requireMainBranchName={branch}
          onEditPassword={!isBusy ? setPassword : undefined}
          onEditUsername={!isBusy ? setUsername : undefined}
        />
        <PanelSeparator title="Authoring information" />
        <AuthorForm
          author={author ?? { name: '', email: '' }}
          onChange={!isBusy ? setCustomAuthor : undefined}
        />
      </div>
      <Button
          fill
          css={css`margin-top: 10px;`}
          intent={canImport ? 'primary' : undefined}
          disabled={!canImport}
          onClick={canImport
            ? performOperation('adding shared repository', handleAdd)
            : undefined}>
        Import
      </Button>
    </div>
  )
}

export default AddSharedRepository;
