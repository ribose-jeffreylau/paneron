/** @jsx jsx */
/** @jsxFrag React.Fragment */

import React, { useContext, useState, useMemo, useCallback } from 'react';
import { jsx, css } from '@emotion/react';
import { Helmet } from 'react-helmet';
import { Button, Classes, Colors, Icon, IconName, InputGroup, Tab, Tabs } from '@blueprintjs/core';
import { Tooltip2 as Tooltip } from '@blueprintjs/popover2';

import useDebounce from '@riboseinc/paneron-extension-kit/useDebounce';

import { createRepository } from 'repositories/ipc';
import type { GitAuthor, Repository } from 'repositories/types';

import useRepositoryList from '../useRepositoryList';
import { Context } from '../context';
import RepositoryDetails from './RepositoryDetails';
import RecentDatasets from './RecentDatasets';
import CreateRepoForm from './CreateRepo';
import AddSharedRepository from './AddSharedRepository';
import RepoSummary from '../repositories/TooltipSummary';


const SPECIAL_SECTIONS = [
  'recent-datasets',
] as const;

type Section = typeof SPECIAL_SECTIONS[number];

interface SectionViewProps {
  onOpenDataset?: (workDir: string, dsID: string) => void
}

interface SectionConfiguration {
  view: React.FC<SectionViewProps>
  title: JSX.Element | string
}

const WelcomeScreen: React.FC<{ onOpenDataset: (workDir: string, dsID: string) => void, onExportDataset?: (workDir: string, dsID: string) => void, className?: string }> =
function ({ onOpenDataset, onExportDataset, className }) {
  const [repoQuery, updateRepoQuery] = useState<string>('');

  const { performOperation, isBusy } = useContext(Context);

  const normalizedRepoFilterString = useDebounce(
    repoQuery.trim() ?? '',
    250);

  const repositories = useRepositoryList({
    matchesText: normalizedRepoFilterString.trim(),
  });

  const handleOpenDataset = useCallback(function handleOpenDataset(workDir: string, datasetID: string) {
    onOpenDataset(workDir, datasetID);
  }, []);

  const handleCreateRepo = useCallback(async function handleCreateRepo(
    title: string,
    author: GitAuthor,
    mainBranchName: string,
  ) {
    performOperation('creating repository', async () => {
      await createRepository.renderer!.trigger({ title, author, mainBranchName });
    })();
  }, []);

  const repoTabs = useMemo((() =>
    repositories.value.objects.map(repo =>
      <Tab
        key={`repo-${repo.gitMeta.workingCopyPath}`}
        disabled={isBusy}
        id={`Repository-${repo.gitMeta.workingCopyPath}`}
        title={<Tooltip position='bottom-right' content={<RepoSummary repo={repo} css={css`font-size: 80%; max-width: 400px;`} />}>
          {/* Without nested div, contents with multiple roots are not shown. Possibly BP4 tooltip limitation. */}
          <div>
            <Icon icon={getRepoIcon(repo)} />&ensp;{repo.gitMeta.label ?? repo.paneronMeta?.title ?? '(no title)'}
          </div>
        </Tooltip>}
        panel={<RepositoryDetails
          workDir={repo.gitMeta.workingCopyPath}
          onOpen={dsID => handleOpenDataset(repo.gitMeta.workingCopyPath, dsID)}
          onExport={onExportDataset
            ? dsID => onExportDataset?.(repo.gitMeta.workingCopyPath, dsID)
            : undefined}
        />}
      />
    )
  ), [isBusy, JSON.stringify(repositories)]);

  return (
    <Tabs
        id="WelcomeScreenNav"
        vertical
        className={`${Classes.ELEVATION_3} ${className ?? ''}`}
        renderActiveTabPanelOnly
        css={css`
          overflow: hidden;
          border-radius: 5px;

          .bp4-tab-list[role=tablist] {
            overflow-y: auto;
            padding: 5px;
            width: 200px;
            background: ${Colors.LIGHT_GRAY4};
            .bp4-dark & {
              background: ${Colors.DARK_GRAY4};
            }
          }
          .bp4-tab-panel[role=tabpanel] {
            overflow-y: auto;
            padding: 2px 2px 2px 0;
            flex: 1;
            position: relative;
            border-left: 1px solid silver;
            .bp4-dark & {
              border-left: 1px solid ${Colors.DARK_GRAY2};
            }
          }
        `}>
      <Helmet>
        <title>Paneron: Repositories</title>
      </Helmet>
      {SPECIAL_SECTIONS.map(sectionID => {
        const SectionView = specialSectionConfiguration[sectionID].view;
        return <Tab
          disabled={isBusy}
          key={sectionID}
          id={sectionID}
          title={specialSectionConfiguration[sectionID].title}
          panel={<SectionView onOpenDataset={handleOpenDataset} />}
        />
      })}
      {repoTabs}
      <Tabs.Expander />
      <Tab
        disabled={isBusy}
        title={<><Icon icon="lab-test" />&ensp;New local repository</>}
        id="create-repo"
        panel={<CreateRepoForm onCreate={handleCreateRepo} css={css`position: absolute; inset: 0; padding: 10px; overflow-y: auto;`} />}
      />
      <Tab
        disabled={isBusy}
        title={<><Icon icon="add" />&ensp;Add shared repository</>}
        id="add-shared-repo"
        panel={
          <AddSharedRepository
            css={css`
              position: absolute;
              inset: 0;
              padding: 10px;
              overflow-y: auto;
            `}
          />
        }
      />
      <InputGroup
        leftIcon="search"
        rightElement={
          repoQuery !== ''
            ? <Button small icon="cross" minimal onClick={() => updateRepoQuery('')} />
            : undefined}
        value={repoQuery}
        css={css`margin-top: 5px; width: 100%;`}
        onChange={evt => updateRepoQuery(evt.currentTarget.value)}
      />
    </Tabs>
  );
};


function getRepoIcon(repo: Repository): IconName {
  const publishingToRemote = repo.gitMeta.remote?.writeAccess === true;
  const fetchingChanges = repo.gitMeta.remote && repo.gitMeta.remote?.writeAccess !== true;
  return publishingToRemote
    ? 'cloud'
    : fetchingChanges
      ? 'cloud-download'
      : 'lab-test';
}


export default WelcomeScreen;


const specialSectionConfiguration: Record<Section, SectionConfiguration> = {
  'recent-datasets': {
    view: RecentDatasets,
    title: <><Icon icon="history" />&ensp;Recent datasets</>,
  },
}
