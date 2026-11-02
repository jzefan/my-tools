import { invoke } from '@tauri-apps/api/core';
import {
  CompressRequest,
  CompressResult,
  DirContent,
  FileItem,
  IntegrationStatus,
  LaunchContext,
  MergeRequest,
  OperationResult,
  QuickPath,
  WatermarkAnalysis,
  WatermarkRemoveRequest,
} from '../types';

export const api = {
  getLaunchContext: async (): Promise<LaunchContext> => {
    return await invoke<LaunchContext>('get_launch_context');
  },

  pollPendingAction: async (): Promise<LaunchContext | null> => {
    return await invoke<LaunchContext | null>('poll_pending_action');
  },

  getDirectoryContents: async (path: string, showHidden?: boolean): Promise<DirContent> => {
    return await invoke<DirContent>('get_directory_contents', { path, showHidden });
  },

  getQuickDirectories: async (): Promise<QuickPath[]> => {
    return await invoke<QuickPath[]>('get_quick_directories');
  },

  getFileInfo: async (path: string): Promise<FileItem> => {
    return await invoke<FileItem>('get_file_info', { path });
  },

  mergeFiles: async (request: MergeRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('merge_files', { request });
  },

  compressPdf: async (request: CompressRequest): Promise<CompressResult> => {
    return await invoke<CompressResult>('compress_pdf_file', { request });
  },

  analyzeWatermarks: async (path: string): Promise<WatermarkAnalysis> => {
    return await invoke<WatermarkAnalysis>('analyze_watermarks', { path });
  },

  removeWatermarks: async (request: WatermarkRemoveRequest): Promise<OperationResult> => {
    return await invoke<OperationResult>('remove_watermarks_from_pdf', { request });
  },

  getIntegrationStatus: async (): Promise<IntegrationStatus> => {
    return await invoke<IntegrationStatus>('get_integration_status');
  },

  installFinderService: async (): Promise<string> => {
    return await invoke<string>('install_finder_service');
  },

  uninstallFinderService: async (): Promise<string> => {
    return await invoke<string>('uninstall_finder_service');
  },

  getWindowsRegContent: async (): Promise<string> => {
    return await invoke<string>('get_windows_reg_content');
  },

  revealInFinder: async (path: string): Promise<void> => {
    return await invoke<void>('reveal_in_finder', { path });
  },

  setWindowMode: async (mode: 'compact' | 'full'): Promise<void> => {
    return await invoke<void>('set_window_mode', { mode });
  },
};
