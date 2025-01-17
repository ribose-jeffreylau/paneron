/** @jsx jsx */
/** @jsxFrag React.Fragment */

import { jsx, ClassNames } from '@emotion/react';
import React, { useEffect, useCallback, useState } from 'react';
import { useDebounce } from 'use-debounce';
import { Button, ButtonProps, Callout, UL } from '@blueprintjs/core';
import { Popover2 } from '@blueprintjs/popover2';
import PropertyView, { TextInput } from '@riboseinc/paneron-extension-kit/widgets/Sidebar/PropertyView';
import { queryGitRemote } from 'repositories/ipc';
import { openExternalURL } from 'common';
import { ColorNeutralLink } from 'renderer/widgets';


interface RemoteTestConfig { remoteURL: string, username: string, password: string };


interface GitCredentialsInputProps {
  username: string
  password: string
  remoteURL: string

  requireBlankRepo?: boolean
  requirePush?: boolean
  requireMainBranchName?: string

  onEditUsername?: (newValue: string) => void
  onEditPassword?: (newValue: string) => void
}
export const GitCredentialsInput: React.FC<GitCredentialsInputProps> =
function ({
  username, password,
  remoteURL,
  requireBlankRepo, requirePush, requireMainBranchName,
  onEditUsername, onEditPassword,
}) {
  const [isBusy, setBusy] = useState(false);
  const [testResult, setTestResult] =
    useState<RepositoryConnectionTestResult | undefined>(undefined);

  const getTestResult = useCallback(
    async function _getTestResult({ password, username, remoteURL }: RemoteTestConfig):
    Promise<RepositoryConnectionTestResult> {
      const remote = await queryGitRemote.renderer!.trigger({
        url: remoteURL,
        username,
        password: password !== '' ? password : undefined,
      });
      return remote.result;
    },
    [],
  );

  const [testCounter, setTestCounter] = useState(0);

  function displayTestResult(result: RepositoryConnectionTestResult | null, error: string | null) {
    if (result) {
      setTestResult(result);
      setTimeout(() => {
        if (!getNotes(result, requireBlankRepo, requirePush, requireMainBranchName)) {
          setTestResult(undefined);
        }
      }, 5000);
    } else if (error) {
      setTestResult({ error });
    }
  }

  const handleTestClick = useCallback(async function _handleTestClick() {
    if (remoteURL) {
      setTestCounter(c => c + 1);
    }
  }, [testCounter, remoteURL]);

  const canTest = !isBusy && remoteURL.trim() !== '';

  const testButtonProps: ButtonProps = {
    disabled: !canTest,
    onClick: handleTestClick,
  };

  const testPassed = testResult && passed(testResult, requireBlankRepo, requirePush, requireMainBranchName);
  const testResultNotes = testResult
    ? getNotes(testResult, requireBlankRepo, requirePush, requireMainBranchName)
    : null;

  if (testPassed) {
    testButtonProps.intent = 'success';
  } else if (testResult !== undefined) {
    testButtonProps.intent = 'danger';
    testButtonProps.text = "Try again";
    testButtonProps.rightIcon = 'warning-sign';
    testButtonProps.alignText = 'left';
  }

  if (testResult === undefined) {
    testButtonProps.text = isBusy ? "Checking credentials…" : "Check credentials";
    testButtonProps.alignText = 'center';

  // Test failed
  } else if (!testPassed) {
    testButtonProps.rightIcon = 'warning-sign';

  // Test passed
  } else {
    if (testResult.canPush) {
      testButtonProps.text = "Write access";
      testButtonProps.rightIcon = 'unlock';
    } else {
      testButtonProps.text = "Read-only access";
      testButtonProps.rightIcon = 'lock';
    }
    if (testResult.isBlank) {
      testButtonProps.text = `${testButtonProps.text}, blank repository`;
    }
  }

  const [debouncedConfig] = useDebounce(
    { password, username, remoteURL },
    888,
    { equalityFn: (prev: unknown, next: unknown) => JSON.stringify(prev) === JSON.stringify(next) },
  )

  useEffect(() => {
    if (!debouncedConfig.remoteURL) { return; }

    setBusy(true);

    let cancelled = false;
    (async () => {
      try {
        const result = await getTestResult(debouncedConfig);
        if (cancelled) { return; }
        displayTestResult(result, null);
      } catch (e) {
        if (cancelled) { return; }
        displayTestResult(null, (e as any)?.toString() ?? 'unknown error');
      } finally {
        if (cancelled) { return; }
        setBusy(false);
      }
    })();
    return function cleanUp() {
      cancelled = true;
    }
  }, [testCounter, debouncedConfig.password, debouncedConfig.username, debouncedConfig.remoteURL]);

  useEffect(() => {
    if (remoteURL) {
      setTestCounter(c => c + 1);
    }
  }, [password, username, remoteURL]);

  function handleOpenGitHubPATHelp() {
    openExternalURL.renderer!.trigger({
      url: "https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token#creating-a-token",
    });
  }

  return (
    <>
      <PropertyView
          label="Username"
          tooltip="In case of GitHub, this is your GitHub account’s username.">
        <TextInput
          value={username}
          inputGroupProps={{ required: true }}
          onChange={onEditUsername
            ? (val) => onEditUsername!(val.replace(/ /g,'-').replace(/[^\w-]+/g,''))
            : undefined} />
      </PropertyView>
      <PropertyView
          label="Secret"
          tooltip={<>
            This token must be provided to Git server to allow Paneron to make changes on your behalf.
            Correctly provided token is required for write access.
            Depending on your Git hosting setup, it could be your account password or a Personal Access Token.
            <UL>
              <li>
                If you have provided it to Paneron before, it might already be stored by your operating system;
                {" "}
                to verify this you can leave it empty and click “Check credentials” to verify you have write access.
              </li>
              <li>
                Note that for repositories hosted on Github you must supply a Personal Access Token
                {" "}
                rather than your Github account’s actual password
                {" "}
                (see <ColorNeutralLink onClick={handleOpenGitHubPATHelp}>Creating a personal access token</ColorNeutralLink>).
              </li>
            </UL>
            {" "}
            Paneron stores your secret token using your operating system’s secret management mechanism,
            {" "}
            such as Keychain on macOS,
            {" "}
            and communicates it only to this remote and only during synchronization.
          </>}>
        <TextInput
          value={onEditPassword ? password : '•••••••••'}
          inputGroupProps={{ type: 'password', placeholder: '•••••••••' }}
          onChange={onEditPassword ? (val) => onEditPassword!(val) : undefined} />
      </PropertyView>
      <ClassNames>
        {({ css, cx }) => (
          <Popover2
              minimal
              fill
              isOpen={testResultNotes !== null}
              placement='bottom'
              popoverClassName={`${css`&& { margin: 10px !important; }`}`}
              content={testResultNotes
                ? <Callout
                      title={testPassed ? "It works, but" : "There may have been an issue"}
                      intent={testPassed ? 'primary' : 'danger'}>
                    {testResultNotes}
                  </Callout>
                : undefined}
              onClose={() => setTestResult(undefined)}>
            <Button
              small
              fill
              outlined
              {...testButtonProps}
              disabled={isBusy}
              css={css`.bp4-button-text { overflow: hidden; }`}
            />
          </Popover2>
        )}
      </ClassNames>
    </>

  );
}

export default GitCredentialsInput;


type RepositoryConnectionTestResult = {
  isBlank: boolean
  canPush: boolean
  mainBranchName?: string
  error?: undefined
} | {
  isBlank?: undefined
  canPush?: undefined
  mainBranchName?: string
  error: string
}

function passed(
  testResult: RepositoryConnectionTestResult,
  requireBlankRepo?: boolean,
  requirePush?: boolean,
  requireMainBranchName?: string,
): boolean {
  return (
    testResult !== undefined &&
    testResult.error === undefined &&
    (!requireBlankRepo || testResult.isBlank) &&
    (!requirePush || testResult.canPush)
    // TODO: Check that requiredMainBranchName exists
    // (!requireMainBranchName || testResult.mainBranchName === requireMainBranchName)
  );
}

function getNotes(
  testResult: RepositoryConnectionTestResult,
  requireBlankRepo?: boolean,
  requirePush?: boolean,
  requireMainBranchName?: string,
): JSX.Element | null {
  if (!passed(testResult, requireBlankRepo, requirePush, requireMainBranchName)) {
    return (
      <UL>
        {testResult.error
          ? <>
              <li>
                There was a problem connecting.
                &emsp;
                <small>({testResult.error?.replace("Error: Error invoking remote method 'queryRemote': ", "") ?? "Error message not available."})</small>
              </li>
              <li>
                Please check repository URL and, if applicable, access credentials.
              </li>
              <li>
                Please check your connection.
              </li>
              <li>
                Wait in case repository hosting is experiencing downtime.
              </li>
              <li>
                Otherwise, please contact us and let us know the error message.
              </li>
            </>
          : <>
              {!testResult.isBlank && requireBlankRepo
                ? <li>Repository is not empty.</li>
                : null}
              {!testResult.canPush && requirePush
                ? <li>There is no write access.</li>
                : null}
              {requireMainBranchName && requireMainBranchName !== testResult.mainBranchName
                ? <li>
                    Main branch name doesn’t match: <code>{requireMainBranchName}</code> was requested,
                    {" "}
                    but this repository appears to be using <code>{testResult.mainBranchName}</code>.
                    {" "}
                    You may want to specify <code>{testResult.mainBranchName}</code>.
                  </li>
                : null}
            </>}
      </UL>
    );
  } else if (!testResult.canPush) {
    return (
      <UL>
        <li>
          If you expect to be able to make changes, please make sure that the username and secret are correct
          and your account has the required access provisioned.
        </li>
        <li>
          Otherwise, you can ignore this message.
        </li>
      </UL>
    );
  } else {
    return null;
  }
}
