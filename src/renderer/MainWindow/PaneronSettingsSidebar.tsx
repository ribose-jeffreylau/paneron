/** @jsx jsx */
/** @jsxFrag React.Fragment */
import { jsx, css } from '@emotion/react';

import React, { useContext, useState } from 'react';
import { Button, Icon, Switch } from '@blueprintjs/core';
import PropertyView, { TextInput, Select } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import makeSidebar from '@riboseinc/paneron-extension-kit/widgets/Sidebar';
import { getNewRepoDefaults, NewRepositoryDefaults, setNewRepoDefaults } from 'repositories/ipc';
import usePaneronPersistentStateReducer from 'state/usePaneronPersistentStateReducer';
import { Context } from './context';
import { Popover2 } from '@blueprintjs/popover2';
import { clearDataAndRestart, ClearOption, CLEAR_OPTIONS } from 'common';
import { updateSetting } from './settings';
import { GlobalSettingsContext } from '@riboseinc/paneron-extension-kit/SettingsContext';


const Sidebar = makeSidebar(usePaneronPersistentStateReducer);


const CLEAR_OPTION_INFO: Record<ClearOption, { label: JSX.Element, description?: JSX.Element, warning?: JSX.Element }> = {
  'ui-state': {
    label: <>UI state and settings</>,
    description: <>The state of application interface (such as what’s selected and which sidebar blocks are collapsed).</>,
  },
  'db-indexes': {
    label: <>Index DBs</>,
    description: <>Indexed data caches. They will be auto-rebuilt on next use.</>,
  },
  plugins: {
    label: <>Extensions</>,
    description: <>Information about installed extensions, as well as themselves. They can be reinstalled afterwords as you need them.</>,
  },
  //settings: {
  //  label: <>Settings</>,
  //  description: <>App settings, such as author name, email, default branch, default Git username, etc.</>,
  //},
  repositories: {
    label: <>Repositories <Icon iconSize={Icon.SIZE_STANDARD} icon="warning-sign" /></>,
    description: <>Information about repositories, as well as new repository defaults (e.g., author name and email), and most importantly <strong>repository data itself</strong>.</>,
    warning: <>This will clear repository configuration <strong>and all local data,</strong> but will not remove repository copies on remote Git servers (you’ll be able to re-import those afterwards). Please double-check all important changes were synchronized.</>,
  }
}


export const PaneronSettingsSidebar: React.FC<{ className?: string; }> = function ({ className }) {
  const { settings, refresh: refreshSettings } = useContext(GlobalSettingsContext);

  const [clearOptionSelection, setClearOptionSelection] = useState<Record<typeof CLEAR_OPTIONS[number], boolean>>({
    plugins: false,
    //settings: false,
    'db-indexes': false,
    'ui-state': false,
    repositories: false,
  });

  const canClear = Object.values(clearOptionSelection).indexOf(true) >= 0;

  async function handleClear() {
    await clearDataAndRestart.renderer!.trigger({
      options: clearOptionSelection,
    });
  }

  async function handleUpdate(key: string, value: any) {
    await updateSetting(
      'global',
      { key, value });
    refreshSettings();
  }

  return <Sidebar
    stateKey='paneron-settings'
    title="Paneron settings"
    className={className}
    blocks={[{
      key: 'new-repo-defaults',
      title: "Repository defaults",
      content: <NewRepositoryDefaults />,
    }, {
      key: 'settings',
      title: "Settings",
      content: <>
        <PropertyView label="Sidebar position">
          <Select
            options={[{ value: 'left', label: "Left" }, { value: 'right', label: "Right" }]}
            onChange={evt => handleUpdate('sidebarPosition', evt.currentTarget.value as 'left' | 'right')}
            value={settings.sidebarPosition}
          />
        </PropertyView>
      </>,
    }, {
      key: 'reset',
      title: "Reset",
      collapsedByDefault: true,
      content: <>
        <div css={css`display: flex; flex-flow: column nowrap; margin-bottom: 5px;`}>
          {CLEAR_OPTIONS.map(opt =>
            <Popover2 interactionKind="hover-target" placement="left" content={<>
                <div css={css`padding: 10px; width: 280px`}>
                  <div>{CLEAR_OPTION_INFO[opt].description}</div>
                  {CLEAR_OPTION_INFO[opt].warning
                    ? <div css={css`font-weight: strong`}>{CLEAR_OPTION_INFO[opt].warning}</div>
                    : null}
                </div>
            </>}>
              <Switch
                css={css`margin: 0;`}
                labelElement={CLEAR_OPTION_INFO[opt].label}
                checked={clearOptionSelection[opt] === true}
                onChange={(evt) => setClearOptionSelection({ ...clearOptionSelection, [opt]: evt.currentTarget.checked })} />
            </Popover2>
          )}
        </div>

        <Button fill small intent={canClear ? 'danger' : undefined} disabled={!canClear} onClick={handleClear}>
          Clear &amp; restart
        </Button>
      </>,
    }]}
  />;
};


const NewRepositoryDefaults: React.FC<Record<never, never>> = function () {
  const { performOperation, isBusy } = useContext(Context);
  const defaultsResp = getNewRepoDefaults.renderer!.useValue({}, { defaults: null });
  const defaults = defaultsResp.value.defaults;
  const busy = defaultsResp.isUpdating || isBusy;

  const [editedDefaults, setEditedDefaults] = useState<NewRepositoryDefaults | null>(null);

  function editAuthor(author: NewRepositoryDefaults["author"]) {
    setEditedDefaults({ ...maybeEditedDefaults, author });
  }

  function editRemoteUsername(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, remote: { ...maybeEditedDefaults.remote, username: val } });
  }

  function editBranch(val: string) {
    setEditedDefaults({ ...maybeEditedDefaults, branch: val });
  }

  const maybeEditedDefaults: NewRepositoryDefaults = { author: { name: '', email: '' }, ...defaults, ...editedDefaults };
  const author = maybeEditedDefaults.author;
  const nameValid = author.name.trim() !== '';
  const emailValid = author.email.trim() !== '';
  const remoteValid = defaults?.remote?.username?.trim() !== ''; // can be undefined by design
  const branchValid = (maybeEditedDefaults?.branch ?? '').trim() !== '';
  const defaultsValid = nameValid && emailValid && remoteValid && branchValid;
  const defaultsChanged = editedDefaults && JSON.stringify(editedDefaults) !== JSON.stringify(defaults ?? {});

  return (
    <>
      <PropertyView label="Author name">
        <TextInput
          onChange={!busy ? (val) => editAuthor({ ...author, name: val }) : undefined}
          validationErrors={author.name === '' ? ['Please specify author name.'] : []}
          value={author.name} />
      </PropertyView>
      <PropertyView label="Author email">
        <TextInput
          onChange={!busy ? (val) => editAuthor({ ...author, email: val }) : undefined}
          validationErrors={author.email === '' ? ['Please specify author email.'] : []}
          value={author.email} />
      </PropertyView>
      <PropertyView label="Remote username">
        <TextInput
          onChange={!busy ? (val) => editRemoteUsername(val) : undefined}
          value={maybeEditedDefaults.remote?.username ?? ''} />
      </PropertyView>
      <PropertyView label="Default branch">
        <TextInput
          onChange={!busy ? (val) => editBranch(val) : undefined}
          validationErrors={!branchValid ? ['Please specify a default branch name, e.g. “master” or “main”'] : []}
          value={maybeEditedDefaults.branch ?? ''} />
      </PropertyView>
      <Button
        disabled={busy || !defaultsValid || !defaultsChanged} small fill outlined
        onClick={editedDefaults
          ? performOperation('updating repository defaults', async () => {
              await setNewRepoDefaults.renderer!.trigger(editedDefaults);
              setEditedDefaults(null);
              defaultsResp.refresh();
            })
          : undefined}>
        Update defaults
      </Button>
    </>
  );
};


export default PaneronSettingsSidebar;
