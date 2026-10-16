import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  TextInput,
  Alert,
  Share,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { DexCamLogger, LogEntry, LogCategory, LogLevel } from './DexCamLogger';

interface Props {
  visible: boolean;
  onClose: () => void;
  serverUrl?: string;
  isEsp32Connected?: boolean;
  isObsConnected?: boolean;
}

type FilterOption = 'ALL' | LogCategory | 'ERROR' | 'METRIC';

const CATEGORIES: FilterOption[] = [
  'ALL',
  'OBS',
  'ESP32',
  'CAMERA',
  'METRIC',
  'ERROR',
  'SYS',
];

export default function AdminConsoleModal({
  visible,
  onClose,
  serverUrl = '',
  isEsp32Connected = false,
  isObsConnected = false,
}: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [savedFiles, setSavedFiles] = useState<{ name: string; size: number }[]>([]);
  const [activeTab, setActiveTab] = useState<'live' | 'files'>('live');
  const [hardware, setHardware] = useState<any>(null);

  const flatListRef = useRef<FlatList>(null);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const context = DexCamLogger.getContext();

  useEffect(() => {
    if (!visible) return;

    // Load initial logs
    setLogs(DexCamLogger.getRingBuffer());

    // Load initial hardware stats
    DexCamLogger.getHardwareStats().then(hw => {
      if (hw) setHardware(hw);
    });
    const hwTimer = setInterval(() => {
      DexCamLogger.getHardwareStats().then(hw => {
        if (hw) setHardware(hw);
      });
    }, 4000);

    // Subscribe to live log stream
    const unsubscribe = DexCamLogger.subscribe(newEntry => {
      if (!isPausedRef.current) {
        setLogs(prev => {
          const next = [...prev, newEntry];
          if (next.length > 500) next.shift();
          return next;
        });
      }
    });

    // Load log files list
    DexCamLogger.listLogFiles().then(files => {
      setSavedFiles(files);
    });

    return () => {
      clearInterval(hwTimer);
      unsubscribe();
    };
  }, [visible]);

  const handleClearLogs = () => {
    Alert.alert(
      'Clear All Logs?',
      'Are you sure you want to delete all stored and active logs? A fresh session will start immediately.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            await DexCamLogger.clearAllLogs();
            setLogs([]);
            const files = await DexCamLogger.listLogFiles();
            setSavedFiles(files);
            setIsClearing(false);
          },
        },
      ]
    );
  };

  const handleExport = async () => {
    try {
      await DexCamLogger.exportLogs();
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Could not export logs');
    }
  };

  const filteredLogs = logs.filter(item => {
    // Category / Error / Metric filter
    if (selectedCategory === 'ERROR') {
      if (item.level !== 'ERROR') return false;
    } else if (selectedCategory === 'METRIC') {
      if (item.level !== 'METRIC') return false;
    } else if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
      return false;
    }

    // Search query filter
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase();
      const matchEvent = item.event.toLowerCase().includes(q);
      const matchCat = item.category.toLowerCase().includes(q);
      const matchData = item.data ? JSON.stringify(item.data).toLowerCase().includes(q) : false;
      const matchErr = item.error ? item.error.toLowerCase().includes(q) : false;
      return matchEvent || matchCat || matchData || matchErr;
    }

    return true;
  });

  const getLevelColor = (level: LogLevel) => {
    switch (level) {
      case 'ERROR':
        return '#ff4757';
      case 'WARN':
        return '#ffa502';
      case 'METRIC':
        return '#2ed573';
      case 'DEBUG':
        return '#70a1ff';
      default:
        return '#eccc68';
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Top Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>DEXCAM ADMIN & DIAGNOSTICS</Text>
            <Text style={styles.subtitle}>
              {context.deviceBrand} {context.deviceModel} · Android {context.androidVersion} · {context.totalMemoryMB}MB RAM
            </Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕ CLOSE</Text>
          </Pressable>
        </View>

        {/* Live Status Bar */}
        <View style={styles.statusBar}>
          <View style={styles.statusItem}>
            <View style={[styles.dot, isObsConnected ? styles.dotGreen : styles.dotGray]} />
            <Text style={styles.statusLabel}>{isObsConnected ? 'OBS LIVE' : 'OBS IDLE'}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.dot, isEsp32Connected ? styles.dotGreen : styles.dotGray]} />
            <Text style={styles.statusLabel}>{isEsp32Connected ? 'ESP32 ON' : 'ESP32 OFF'}</Text>
          </View>
          <View style={styles.statusItem}>
            <View style={[styles.dot, serverUrl ? styles.dotGreen : styles.dotGray]} />
            <Text style={styles.statusLabel}>{serverUrl ? 'SRV :8000' : 'NO SERVER'}</Text>
          </View>
          <Text style={styles.sessionCounter}>{logs.length} logs in RAM</Text>
        </View>

        {/* Hardware & Thermals Strip */}
        {hardware && (
          <View style={styles.hardwareStrip}>
            <View style={styles.hwChip}>
              <Text style={styles.hwEmoji}>🌡️</Text>
              <Text
                style={[
                  styles.hwText,
                  hardware.batteryTempC >= 40 ? styles.hwHot : null,
                ]}
              >
                {hardware.batteryTempC.toFixed(1)}°C {hardware.batteryTempC >= 40 ? '(WARM)' : ''}
              </Text>
            </View>
            <View style={styles.hwChip}>
              <Text style={styles.hwEmoji}>🔋</Text>
              <Text style={styles.hwText}>
                {hardware.batteryLevel}% {hardware.isCharging ? '⚡' : ''}
              </Text>
            </View>
            <View style={styles.hwChip}>
              <Text style={styles.hwEmoji}>🧠</Text>
              <Text style={styles.hwText}>
                {Math.round(hardware.usedMemoryMB / 1024 * 10) / 10} / {Math.round(hardware.totalMemoryMB / 1024 * 10) / 10} GB
              </Text>
            </View>
            {hardware.thermalStatus && hardware.thermalStatus !== 'NONE' && hardware.thermalStatus !== 'UNSUPPORTED' && (
              <View style={[styles.hwChip, styles.hwThrottlingChip]}>
                <Text style={styles.hwThrottlingText}>⚠️ {hardware.thermalStatus}</Text>
              </View>
            )}
          </View>
        )}

        {/* Search & Action Controls */}
        <View style={styles.controlsRow}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search logs (e.g. drop, fps, error)..."
            placeholderTextColor="#717a8a"
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setIsPaused(!isPaused)}
            style={[styles.actionBtn, isPaused ? styles.actionBtnActive : null]}
          >
            <Text style={styles.actionBtnText}>{isPaused ? '▶ RESUME' : '⏸ PAUSE'}</Text>
          </Pressable>
          <Pressable onPress={handleExport} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>📤 EXPORT</Text>
          </Pressable>
          <Pressable onPress={handleClearLogs} style={[styles.actionBtn, styles.clearBtn]}>
            {isClearing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.clearBtnText}>🗑️ CLEAR</Text>
            )}
          </Pressable>
        </View>

        {/* Category Filters */}
        <View style={styles.filterRow}>
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat}
              onPress={() => setSelectedCategory(cat)}
              style={[
                styles.filterChip,
                selectedCategory === cat ? styles.filterChipSelected : null,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedCategory === cat ? styles.filterChipTextSelected : null,
                ]}
              >
                {cat}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Log Stream / Serial Monitor */}
        <View style={styles.terminalContainer}>
          <FlatList
            ref={flatListRef}
            data={filteredLogs}
            keyExtractor={item => item.id}
            onContentSizeChange={() => {
              if (!isPaused && filteredLogs.length > 0) {
                flatListRef.current?.scrollToEnd({ animated: false });
              }
            }}
            renderItem={({ item }) => {
              const levelColor = getLevelColor(item.level);
              return (
                <View style={styles.logLine}>
                  <Text style={styles.logTime}>{item.timestampLocal}</Text>
                  <Text style={[styles.logLevel, { color: levelColor }]}>[{item.level}]</Text>
                  <Text style={styles.logCategory}>[{item.category}]</Text>
                  <Text style={styles.logEvent}>{item.event}</Text>
                  {item.data ? (
                    <Text style={styles.logData}>{JSON.stringify(item.data)}</Text>
                  ) : null}
                  {item.error ? (
                    <Text style={styles.logError}>❌ {item.error}</Text>
                  ) : null}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No logs matching filter.</Text>
              </View>
            }
          />
        </View>

        {/* Footer Info */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Web Admin: {serverUrl ? `${serverUrl}/admin` : 'Start Remote Mode to access PC Web Admin'}
          </Text>
          <Text style={styles.footerSub}>DexCam Telemetry v1.3 · Storage Clean Engine Active</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0d14',
    paddingTop: 40,
    paddingHorizontal: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  title: {
    color: '#f1bd76',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  subtitle: {
    color: '#838d9e',
    fontSize: 10,
    marginTop: 2,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  dotGreen: {
    backgroundColor: '#2ed573',
  },
  dotGray: {
    backgroundColor: '#57606f',
  },
  statusLabel: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '700',
  },
  sessionCounter: {
    marginLeft: 'auto',
    color: '#717a8a',
    fontSize: 9,
  },
  hardwareStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    flexWrap: 'wrap',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  hwChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131822',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  hwEmoji: {
    fontSize: 10,
    marginRight: 4,
  },
  hwText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  hwHot: {
    color: '#ff4757',
  },
  hwThrottlingChip: {
    backgroundColor: 'rgba(255, 71, 87, 0.2)',
    borderColor: '#ff4757',
  },
  hwThrottlingText: {
    color: '#ff4757',
    fontSize: 8.5,
    fontWeight: '800',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 32,
    backgroundColor: '#131822',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    color: '#fff',
    fontSize: 10,
    paddingHorizontal: 8,
  },
  actionBtn: {
    paddingHorizontal: 8,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: '#1b2230',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionBtnActive: {
    backgroundColor: '#ffa502',
  },
  actionBtnText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
  },
  clearBtn: {
    borderColor: 'rgba(255, 71, 87, 0.4)',
    backgroundColor: 'rgba(255, 71, 87, 0.15)',
  },
  clearBtnText: {
    color: '#ff4757',
    fontSize: 9,
    fontWeight: '800',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginVertical: 8,
  },
  filterChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#161d28',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  filterChipSelected: {
    backgroundColor: '#f1bd76',
    borderColor: '#f1bd76',
  },
  filterChipText: {
    color: '#838d9e',
    fontSize: 9,
    fontWeight: '700',
  },
  filterChipTextSelected: {
    color: '#0a0d14',
    fontWeight: '800',
  },
  terminalContainer: {
    flex: 1,
    backgroundColor: '#05070a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 6,
  },
  logLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  logTime: {
    color: '#57606f',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginRight: 5,
  },
  logLevel: {
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '700',
    marginRight: 4,
  },
  logCategory: {
    color: '#70a1ff',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginRight: 4,
  },
  logEvent: {
    color: '#f1f2f6',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontWeight: '600',
    marginRight: 6,
  },
  logData: {
    color: '#a4b0be',
    fontSize: 8.5,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logError: {
    width: '100%',
    color: '#ff4757',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#57606f',
    fontSize: 11,
  },
  footer: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  footerText: {
    color: '#f1bd76',
    fontSize: 9,
    fontWeight: '700',
  },
  footerSub: {
    color: '#57606f',
    fontSize: 8,
    marginTop: 2,
  },
});
