import { Platform, NativeModules, Share } from 'react-native';
import RNFS from 'react-native-fs';
import DeviceInfo from 'react-native-device-info';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'METRIC';
export type LogCategory = 'OBS' | 'ESP32' | 'CAMERA' | 'SYS' | 'NETWORK' | 'USER';

export interface LogEntry {
  id: string;
  timestamp: string; // ISO 8601
  timestampLocal: string; // HH:mm:ss.SSS
  level: LogLevel;
  category: LogCategory;
  event: string;
  data?: Record<string, any>;
  error?: string;
  stack?: string;
}

export interface HardwareStats {
  batteryTempC: number;
  batteryLevel: number;
  isCharging: boolean;
  totalMemoryMB: number;
  usedMemoryMB: number;
  freeMemoryMB: number;
  thermalStatus: string;
}

export interface DeviceTelemetryContext {
  installId: string;
  sessionId: string;
  appVersion: string;
  buildNumber: string;
  deviceModel: string;
  deviceBrand: string;
  androidVersion: number | string;
  totalMemoryMB: number;
  sessionStartTime: string;
  hardware?: HardwareStats;
}

const MAX_RING_BUFFER_SIZE = 500;
const LOGS_DIR = `${RNFS.DocumentDirectoryPath}/DexCamLogs`;
const INSTALL_ID_FILE = `${RNFS.DocumentDirectoryPath}/dexcam_install_id.txt`;

class DexCamLoggerService {
  private ringBuffer: LogEntry[] = [];
  private listeners: Set<(entry: LogEntry) => void> = new Set();
  private batchBuffer: LogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private currentLogFilePath: string = '';
  private context: DeviceTelemetryContext = {
    installId: 'unknown',
    sessionId: '',
    appVersion: '1.4',
    buildNumber: '5',
    deviceModel: 'Unknown',
    deviceBrand: 'Unknown',
    androidVersion: 'Unknown',
    totalMemoryMB: 0,
    sessionStartTime: new Date().toISOString(),
  };
  private isInitialized = false;

  constructor() {
    this.context.sessionId = this.generateId();
    this.context.sessionStartTime = new Date().toISOString();
  }

  public async init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    try {
      // 1. Ensure logs directory exists
      const dirExists = await RNFS.exists(LOGS_DIR);
      if (!dirExists) {
        await RNFS.mkdir(LOGS_DIR);
      }

      // 2. Load or generate persistent installId
      const hasInstallId = await RNFS.exists(INSTALL_ID_FILE);
      if (hasInstallId) {
        this.context.installId = (await RNFS.readFile(INSTALL_ID_FILE, 'utf8')).trim();
      } else {
        this.context.installId = this.generateId();
        await RNFS.writeFile(INSTALL_ID_FILE, this.context.installId, 'utf8').catch(() => {});
      }

      // 3. Load Device Specs
      this.context.deviceModel = DeviceInfo.getModel();
      this.context.deviceBrand = DeviceInfo.getBrand();
      this.context.androidVersion = Platform.OS === 'android' ? Platform.Version : 'Unknown';
      this.context.appVersion = DeviceInfo.getVersion() || '1.4';
      this.context.buildNumber = DeviceInfo.getBuildNumber() || '5';
      const totalMem = await DeviceInfo.getTotalMemory().catch(() => 0);
      this.context.totalMemoryMB = Math.round(totalMem / (1024 * 1024));

      // 4. Create session log file path
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentLogFilePath = `${LOGS_DIR}/session_${dateStr}.log`;

      // 5. Write Header to session log file
      const header = {
        type: 'SESSION_START',
        context: this.context,
        timestamp: new Date().toISOString(),
      };
      await RNFS.appendFile(
        this.currentLogFilePath,
        JSON.stringify(header) + '\n',
        'utf8'
      ).catch(() => {});

      // 6. Start 15s batched disk flusher
      this.flushTimer = setInterval(() => {
        this.flushBatchToDisk();
      }, 15000);

      this.info('SYS', 'app_logger_initialized', {
        device: `${this.context.deviceBrand} ${this.context.deviceModel}`,
        ramMB: this.context.totalMemoryMB,
        osVersion: this.context.androidVersion,
      });

      // 7. Auto cleanup files older than 7 days
      this.cleanOldLogs(7);
    } catch (err) {
      console.warn('[DexCamLogger] Init error:', err);
    }
  }

  public getContext(): DeviceTelemetryContext {
    return this.context;
  }

  public async getHardwareStats(): Promise<HardwareStats | null> {
    try {
      const { BlogCamHardware } = NativeModules;
      if (BlogCamHardware && typeof BlogCamHardware.getHardwareStats === 'function') {
        const stats: HardwareStats = await BlogCamHardware.getHardwareStats();
        this.context.hardware = stats;
        return stats;
      }
    } catch (_) {}
    return null;
  }

  public debug(category: LogCategory, event: string, data?: Record<string, any>) {
    this.log('DEBUG', category, event, data);
  }

  public info(category: LogCategory, event: string, data?: Record<string, any>) {
    this.log('INFO', category, event, data);
  }

  public warn(category: LogCategory, event: string, data?: Record<string, any>) {
    this.log('WARN', category, event, data);
  }

  public error(category: LogCategory, event: string, data?: Record<string, any>, error?: any) {
    const errorMsg = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
    const stack = error instanceof Error ? error.stack : undefined;
    this.log('ERROR', category, event, data, errorMsg, stack);

    // Emergency immediate flush on errors
    this.flushBatchToDisk();
  }

  public metric(category: LogCategory, event: string, data?: Record<string, any>) {
    this.log('METRIC', category, event, data);
  }

  private log(
    level: LogLevel,
    category: LogCategory,
    event: string,
    data?: Record<string, any>,
    error?: string,
    stack?: string
  ) {
    const now = new Date();
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: now.toISOString(),
      timestampLocal: now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0'),
      level,
      category,
      event,
      data,
      error,
      stack,
    };

    // 1. In-Memory Ring Buffer
    if (this.ringBuffer.length >= MAX_RING_BUFFER_SIZE) {
      this.ringBuffer.shift();
    }
    this.ringBuffer.push(entry);

    // 2. Queue for batched disk write
    this.batchBuffer.push(entry);

    // 3. Notify real-time listeners (In-App Serial Monitor)
    this.listeners.forEach(fn => {
      try {
        fn(entry);
      } catch {}
    });

    // 4. Console output in DEV
    if (__DEV__) {
      console.log(`[${entry.timestampLocal}][${level}][${category}] ${event}`, data || '');
    }
  }

  public subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRingBuffer(): LogEntry[] {
    return [...this.ringBuffer];
  }

  public async flushBatchToDisk() {
    if (this.batchBuffer.length === 0 || !this.currentLogFilePath) return;

    const toWrite = this.batchBuffer.splice(0, this.batchBuffer.length);
    const lines = toWrite.map(item => JSON.stringify(item)).join('\n') + '\n';

    try {
      await RNFS.appendFile(this.currentLogFilePath, lines, 'utf8');
    } catch (e) {
      console.warn('[DexCamLogger] Disk flush failed:', e);
    }
  }

  public async listLogFiles(): Promise<{ name: string; path: string; size: number; mtime: Date }[]> {
    try {
      const exists = await RNFS.exists(LOGS_DIR);
      if (!exists) return [];
      const files = await RNFS.readDir(LOGS_DIR);
      return files
        .filter(f => f.isFile() && f.name.endsWith('.log'))
        .map(f => ({
          name: f.name,
          path: f.path,
          size: f.size,
          mtime: f.mtime ? new Date(f.mtime) : new Date(),
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    } catch {
      return [];
    }
  }

  public async readLogFile(pathOrName: string): Promise<string> {
    try {
      const fullPath = pathOrName.startsWith('/') ? pathOrName : `${LOGS_DIR}/${pathOrName}`;
      const exists = await RNFS.exists(fullPath);
      if (!exists) return 'File not found';
      return await RNFS.readFile(fullPath, 'utf8');
    } catch (err: any) {
      return `Failed to read log: ${err?.message || err}`;
    }
  }

  public async clearAllLogs(): Promise<boolean> {
    try {
      // 1. Clear RAM buffer
      this.ringBuffer = [];
      this.batchBuffer = [];

      // 2. Clear files on disk
      const files = await this.listLogFiles();
      for (const file of files) {
        await RNFS.unlink(file.path).catch(() => {});
      }

      // 3. Re-create new clean session file
      const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
      this.currentLogFilePath = `${LOGS_DIR}/session_${dateStr}.log`;
      const header = {
        type: 'LOGS_CLEARED_FRESH_START',
        context: this.context,
        timestamp: new Date().toISOString(),
      };
      await RNFS.appendFile(this.currentLogFilePath, JSON.stringify(header) + '\n', 'utf8').catch(() => {});

      this.info('SYS', 'logs_cleared', { message: 'All logs cleared by developer' });
      return true;
    } catch (err) {
      console.warn('[DexCamLogger] Clear logs failed:', err);
      return false;
    }
  }

  public async exportLogs(): Promise<void> {
    await this.flushBatchToDisk();
    try {
      const files = await this.listLogFiles();
      if (files.length === 0) {
        throw new Error('No log files available to export');
      }

      const latestLog = files[0];
      const content = await RNFS.readFile(latestLog.path, 'utf8');

      await Share.share({
        title: `DexCam Logs - ${this.context.deviceModel}`,
        message: content.slice(0, 50000), // share snippet or intent
      });
    } catch (err: any) {
      console.warn('[DexCamLogger] Export failed:', err);
    }
  }

  private async cleanOldLogs(maxDays: number) {
    try {
      const files = await this.listLogFiles();
      const cutoffTime = Date.now() - maxDays * 24 * 60 * 60 * 1000;
      for (const file of files) {
        if (file.mtime.getTime() < cutoffTime && file.path !== this.currentLogFilePath) {
          await RNFS.unlink(file.path).catch(() => {});
        }
      }
    } catch {}
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }
}

export const DexCamLogger = new DexCamLoggerService();
