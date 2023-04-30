/** Storing & retrieving credentials for Git server authentication. */

import keytar from 'keytar';
import log from 'electron-log';


/**
 * Fetches password associated with the hostname of given remote URL
 * (if that fails, with full remote URL)
 * and with given username.

 * Returns { username, password }; password may be undefined.
 *
 * Does not throw.
 */
export async function getAuth(remote: string, username: string): Promise<{ password: string | undefined; username: string; }> {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: getAuth: Likely malformed Git remote URL", remote);
    url = null;
  }

  let password: string | undefined;
  try {
    password =
      (url?.hostname ? await keytar.getPassword(url.hostname, username) : undefined) ||
      await keytar.getPassword(remote, username) ||
      undefined;
  } catch (e) {
    log.warn("Repositories: getAuth: Error retrieving password using keytar", remote, username, e);
    password = undefined;
  }

  return { password, username };
}


/** Stores password using OS mechanism (via keytar bindings). Can throw. */
export async function saveAuth(remote: string, username: string, password: string) {
  let url: URL | null;
  try {
    url = new URL(remote);
  } catch (e) {
    log.warn("Repositories: saveAuth: Likely malformed Git remote URL", remote);
    url = null;
  }

  const service = url?.hostname ?? remote;
  try {
    await keytar.setPassword(service, username, password);
  } catch (e) {
    log.error("Repositories: saveAuth: Error saving password using keytar", remote, username, e);
    throw e;
  }
}
