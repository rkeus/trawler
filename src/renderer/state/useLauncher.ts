import { useCallback, useState } from 'react';
import type { ConcreteFolderPolicy } from '../../engine';
import type { StartJobRequest } from '../../shared/ipc';
import { errorText } from '../api';
import { useApp } from './AppProvider';

/**
 * Starts jobs for a screen. A download into a non-empty folder asks first when the setting says "ask": `pending`
 * holds that request until the user picks a policy (FolderPolicyDialog) or cancels. `error` is the last failure.
 */
export function useLauncher() {
  const { api, startJob, model } = useApp();
  const saved = model.settings!.settings;
  const [error, setError] = useState('');
  const [pending, setPending] = useState<StartJobRequest | null>(null);

  const launch = useCallback(
    async (request: StartJobRequest): Promise<void> => {
      setError('');
      try {
        if (request.kind === 'download' && request.outputDir && !request.folderPolicy) {
          const policy = request.settings && 'nonEmptyFolder' in request.settings ? request.settings.nonEmptyFolder : saved.nonEmptyFolder;
          if (policy === 'ask' && (await api.inspectFolder(request.outputDir)) === 'non-empty') {
            setPending(request);
            return;
          }
        }
        await startJob(request);
      } catch (err) {
        setError(errorText(err));
      }
    },
    [api, startJob, saved.nonEmptyFolder],
  );

  const choosePolicy = useCallback(
    (policy: ConcreteFolderPolicy): void => {
      const request = pending;
      setPending(null);
      if (request) void launch({ ...request, folderPolicy: policy });
    },
    [pending, launch],
  );

  const cancelPending = useCallback((): void => setPending(null), []);

  return { error, setError, pending, launch, choosePolicy, cancelPending };
}
