import { Platform } from 'react-native';
import * as Updates from 'expo-updates';

// Sent with every API call (docs/PLATFORM_FOUNDATIONS.md D21), so the server knows exactly which update a phone runs.
export const updateHeaders: Record<string, string> = {
  'x-app': 'one-local',
  'x-platform': Platform.OS,
  ...(Updates.runtimeVersion ? { 'x-runtime': Updates.runtimeVersion } : {}),
  ...(Updates.updateId ? { 'x-update-id': Updates.updateId } : {}),
  ...(Updates.channel ? { 'x-update-channel': Updates.channel } : {}),
};
